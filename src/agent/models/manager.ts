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
import { isFailoverError, describeFailoverError, resolveFallbackCandidates } from '../fallback/index.js';

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
      const found = resolveModel(modelId);
      if (!found) {
        log.warn({ modelId }, 'Model not found');
        return false;
      }

      this.sessionModels.set(sessionKey, modelId);
      log.info({ sessionKey, modelId }, 'Model switched for session');
      return true;
    } catch (err) {
      log.error({ err, sessionKey, modelId }, 'Failed to switch model');
      return false;
    }
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
      
      let candidateModel: Model<Api>;
      try {
        candidateModel = resolveModel(`${candidate.provider}/${candidate.model}`);
      } catch {
        log.warn(
          { provider: candidate.provider, model: candidate.model },
          'Fallback model not found'
        );
        continue;
      }

      log.info(
        { attempt: i + 1, total: candidates.length, provider: candidate.provider, model: candidate.model },
        'Attempting model'
      );

      try {
        // Update the agent with the new model
        agent.setModel(candidateModel);
        this.currentProvider = candidate.provider;
        this.currentModelName = candidate.model;

        // Execute the prompt with timeout to prevent infinite hangs
        const AGENT_TURN_TIMEOUT_MS = 120_000; // 2 minutes

        const turnPromise = (async () => {
          await agent.prompt(userMessage);
          await agent.waitForIdle();
        })();

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Agent turn timed out after ${AGENT_TURN_TIMEOUT_MS / 1000}s`)),
            AGENT_TURN_TIMEOUT_MS
          )
        );

        await Promise.race([turnPromise, timeoutPromise]);

        // Get usage from agent state if available
        const usage = (agent.state as any).lastUsage || undefined;

        // Log the successfully used model
        log.info(
          { provider: candidate.provider, model: candidate.model, success: true },
          'Model call completed'
        );

        return {
          content: getLastAssistantContent(agent),
          usage,
        };
      } catch (err) {
        lastError = err;

        // Enhanced error logging
        const errorDetails = {
          attempt: i + 1,
          provider: candidate.provider,
          model: candidate.model,
          errorMessage: err instanceof Error ? err.message : String(err),
          errorName: err instanceof Error ? err.name : 'Unknown',
          errorStack: err instanceof Error ? err.stack : undefined,
          isTimeout: err instanceof Error && err.message.includes('timed out'),
          isAbort: err instanceof DOMException && err.name === 'AbortError',
        };

        // Don't fallback on user abort
        if (err instanceof DOMException && err.name === 'AbortError') {
          log.info(errorDetails, 'User aborted model call');
          throw err;
        }

        if (isFailoverError(err)) {
          const described = describeFailoverError(err);
          log.warn(
            { ...errorDetails, ...described },
            'Model call failed, trying fallback'
          );
        } else {
          log.warn(
            errorDetails,
            'Model call failed with non-failover error'
          );
        }

        // Continue to next candidate
        continue;
      }
    }

    // All models failed
    if (lastError) {
      log.error({
        lastError: lastError instanceof Error ? lastError.message : String(lastError),
        lastErrorStack: lastError instanceof Error ? lastError.stack : undefined,
        attemptedCandidates: candidates.length,
        sessionKey,
      }, 'All model candidates failed');
      throw lastError;
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
