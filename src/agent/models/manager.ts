/**
 * Model management module
 * 
 * Handles model selection, switching, and automatic fallback
 * when a provider fails.
 */

import { Agent, type AgentMessage } from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';
import { type Config, getAgentDefaultModelRef } from '../../config/schema.js';
import { createLogger } from '../../utils/logger.js';
import { resolveModel, getAllModels as getAllModelsFromProviders, getDefaultModelSync } from '../../providers/index.js';
import {
  isFailoverError,
  describeFailoverError,
  resolveFallbackCandidates,
  type ModelCandidate,
} from '../fallback/index.js';
import { parseModelRef } from './selection.js';
import {
  isAssistantTurnAborted,
  isAssistantTurnFailed,
  maybeRetryTurnAfterTransientLlmFailure,
} from '../orchestration/llm-turn-retry.js';
import { AGENT_TURN_TIMEOUT_MS, runAgentTurnWithTimeout } from '../orchestration/run-agent-turn-with-timeout.js';

const log = createLogger('ModelManager');

export interface ModelManagerConfig {
  defaultModel?: string;
  config?: Config;
}

export interface RunResult {
  content: string | null;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Get the last assistant content from agent messages
 */
function getLastAssistantContent(agent: Agent): string | null {
  const messages = agent.state.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      return msg.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text || '')
        .join('');
    }
  }
  return null;
}

export class ModelManager {
  private defaultModel: string;
  private config?: Config;
  private currentModelName: string;
  private currentProvider: string;
  private sessionModels: Map<string, string> = new Map();
  private channelManager?: any;

  constructor(config: ModelManagerConfig = {}) {
    this.config = config.config;
    this.defaultModel = config.defaultModel || getDefaultModelSync(config.config);
    this.currentModelName = this.defaultModel;
    this.currentProvider = this.defaultModel.split('/')[0] || 'anthropic';
  }

  /**
   * Set channel manager reference for accessing session-specific settings
   */
  setChannelManager(channelManager: any): void {
    this.channelManager = channelManager;
  }

  /**
   * Apply updated config so default model and failover metadata match disk/runtime config.
   */
  updateFromConfig(config: Config): void {
    this.config = config;
    const ref = getAgentDefaultModelRef(config);
    this.defaultModel = ref ? ref : getDefaultModelSync(config);
  }

  /**
   * Get current model name
   */
  getCurrentModel(): string {
    return this.currentModelName;
  }

  /**
   * Get current provider
   */
  getCurrentProvider(): string {
    return this.currentProvider;
  }

  /**
   * Switch model for a specific session
   */
  async switchModelForSession(sessionKey: string, modelId: string): Promise<boolean> {
    try {
      resolveModel(modelId);
      this.sessionModels.set(sessionKey, modelId);
      log.info({ sessionKey, modelId }, 'Model switched for session');
      return true;
    } catch (err) {
      log.error({ err, sessionKey, modelId }, 'Failed to switch model');
      return false;
    }
  }

  /** Drop in-memory session override so the global default is used again. */
  clearSessionModelOverride(sessionKey: string): void {
    this.sessionModels.delete(sessionKey);
  }

  /**
   * Resolved pi-ai model for session (for transcript policy, tools, etc.)
   */
  getResolvedModelForSession(sessionKey: string): Model<Api> {
    return resolveModel(this.getModelForSession(sessionKey));
  }

  /**
   * Get model for session, checking session override first
   */
  getModelForSession(sessionKey: string): string {
    // Check if there's a session-specific model override
    const sessionModel = this.sessionModels.get(sessionKey);
    if (sessionModel) {
      return sessionModel;
    }

    // Fall back to default
    return this.defaultModel;
  }

  /**
   * Apply model to agent if different from current
   */
  async applyModelForSession(agent: Agent, sessionKey: string): Promise<void> {
    const targetModelId = this.getModelForSession(sessionKey);

    let found: Model<Api>;
    try {
      found = resolveModel(targetModelId);
    } catch (err) {
      log.error({ err, sessionKey, modelId: targetModelId }, 'Failed to apply model');
      return;
    }

    const sm = agent.state.model as Model<Api> | undefined;
    if (sm && sm.provider === found.provider && sm.id === found.id) {
      this.currentModelName = targetModelId;
      this.currentProvider = found.provider || 'unknown';
      return;
    }

    agent.setModel(found);
    this.currentModelName = targetModelId;
    this.currentProvider = found.provider || 'unknown';

    log.info({ sessionKey, modelId: targetModelId }, 'Applied model for session');
  }

  /**
   * Ordered model candidates for the session (primary + `agents.defaults.model.fallbacks`).
   */
  getFallbackCandidatesForSession(sessionKey: string): ModelCandidate[] {
    const ref = this.getModelForSession(sessionKey);
    const parsed = parseModelRef(ref);
    if (!parsed) {
      return [];
    }
    return resolveFallbackCandidates({
      cfg: this.config,
      provider: parsed.provider,
      model: parsed.model,
    });
  }

  /**
   * Apply a resolved pi-ai model and sync {@link currentModelName} / {@link currentProvider}.
   */
  applyResolvedModel(agent: Agent, model: Model<Api>, modelRef: string): void {
    agent.setModel(model);
    this.currentModelName = modelRef;
    this.currentProvider = model.provider || 'unknown';
  }

  /**
   * Run the agent with automatic model fallback on failure.
   */
  async runWithFallback(
    agent: Agent,
    sessionKey: string,
    userMessage: AgentMessage,
    provider: string,
    model: string
  ): Promise<RunResult> {
    const candidates = resolveFallbackCandidates({
      cfg: this.config ?? undefined,
      provider,
      model,
    });

    let lastError: unknown;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const modelRef = `${candidate.provider}/${candidate.model}`;

      let candidateModel: Model<Api>;
      try {
        candidateModel = resolveModel(modelRef);
      } catch {
        log.warn({ provider: candidate.provider, model: candidate.model }, 'Fallback model not found');
        continue;
      }

      log.info(
        { attempt: i + 1, total: candidates.length, provider: candidate.provider, model: candidate.model },
        'Attempting model',
      );

      const beforeLen = agent.state.messages.length;

      try {
        this.applyResolvedModel(agent, candidateModel, modelRef);

        const runTurn = async () => {
          await agent.prompt(userMessage);
          await agent.waitForIdle();
          await maybeRetryTurnAfterTransientLlmFailure(agent, { sessionKey, log });
        };

        await runAgentTurnWithTimeout(agent, runTurn, AGENT_TURN_TIMEOUT_MS);

        if (isAssistantTurnAborted(agent)) {
          const usage = (agent.state as { lastUsage?: RunResult['usage'] }).lastUsage;
          return { content: getLastAssistantContent(agent), usage };
        }

        if (!isAssistantTurnFailed(agent)) {
          const usage = (agent.state as { lastUsage?: RunResult['usage'] }).lastUsage;
          log.info(
            { provider: candidate.provider, model: candidate.model, success: true },
            'Model call completed',
          );
          return { content: getLastAssistantContent(agent), usage };
        }

        lastError = new Error(`Assistant turn failed: ${modelRef}`);
        log.warn(
          { attempt: i + 1, sessionKey, modelRef },
          'Model turn failed after retries, trying fallback',
        );
      } catch (err) {
        lastError = err;
        if (err instanceof DOMException && err.name === 'AbortError') {
          log.info({ sessionKey }, 'User aborted model call');
          throw err;
        }

        const errorDetails = {
          attempt: i + 1,
          provider: candidate.provider,
          model: candidate.model,
          errorMessage: err instanceof Error ? err.message : String(err),
        };

        if (isFailoverError(err)) {
          const described = describeFailoverError(err);
          log.warn({ ...errorDetails, ...described }, 'Model call failed, trying fallback');
        } else {
          log.warn(errorDetails, 'Model call failed, trying fallback');
        }
      }

      agent.replaceMessages(agent.state.messages.slice(0, beforeLen));
    }

    if (lastError) {
      log.error(
        {
          lastError: lastError instanceof Error ? lastError.message : String(lastError),
          attemptedCandidates: candidates.length,
          sessionKey,
        },
        'All model candidates failed',
      );
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    return { content: null };
  }

  /**
   * Find model by reference (provider/modelId)
   */
  findByRef(ref: string): Model<Api> | undefined {
    try {
      return resolveModel(ref);
    } catch {
      return undefined;
    }
  }

  /**
   * Find model by provider and ID
   */
  find(provider: string, modelId: string): Model<Api> | undefined {
    try {
      return resolveModel(`${provider}/${modelId}`);
    } catch {
      return undefined;
    }
  }

  /**
   * Get all available models
   */
  getAllModels(): readonly Model<Api>[] {
    return getAllModelsFromProviders();
  }

  /**
   * Get models grouped by provider
   */
  getModelsByProvider(): Map<string, Model<Api>[]> {
    const all = this.getAllModels();
    const grouped = new Map<string, Model<Api>[]>();
    for (const model of all) {
      const list = grouped.get(model.provider) ?? [];
      list.push(model);
      grouped.set(model.provider, list);
    }
    return grouped;
  }
}
