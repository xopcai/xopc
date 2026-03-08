/**
 * Model management module
 * 
 * Handles model selection, switching, and automatic fallback
 * when a provider fails.
 */

import { Agent, type AgentMessage } from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';
import type { Config } from '../../config/schema.js';
import { createLogger } from '../../utils/logger.js';
import { resolveModel, getAvailableModels, DEFAULT_MODEL } from '../../providers/index.js';
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
    this.defaultModel = config.defaultModel || DEFAULT_MODEL;
    this.currentModelName = this.defaultModel;
    this.currentProvider = 'anthropic';
  }

  /**
   * Set channel manager reference for accessing session-specific settings
   */
  setChannelManager(channelManager: any): void {
    this.channelManager = channelManager;
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
   * Get model for session, checking session override first
   */
  getModelForSession(sessionKey: string): string {
    // Check if there's a session-specific model override
    const sessionModel = this.sessionModels.get(sessionKey);
    if (sessionModel) {
      return sessionModel;
    }

    // Check Telegram channel for session model
    if (this.channelManager && sessionKey.startsWith('telegram:')) {
      const telegram = this.channelManager.getChannel('telegram');
      if (telegram?.getSessionModel) {
        const tgModel = telegram.getSessionModel(sessionKey);
        if (tgModel) {
          // Cache it for future use
          this.sessionModels.set(sessionKey, tgModel);
          return tgModel;
        }
      }
    }

    // Fall back to default
    return this.defaultModel;
  }

  /**
   * Apply model to agent if different from current
   */
  async applyModelForSession(agent: Agent, sessionKey: string): Promise<void> {
    const targetModelId = this.getModelForSession(sessionKey);
    
    if (targetModelId === this.currentModelName) {
      return; // No change needed
    }

    try {
      const found = resolveModel(targetModelId);
      if (!found) {
        log.warn({ modelId: targetModelId }, 'Model not found, keeping current');
        return;
      }

      agent.setModel(found);
      this.currentModelName = targetModelId;
      this.currentProvider = found.provider || 'unknown';
      
      log.info({ sessionKey, modelId: targetModelId }, 'Applied model for session');
    } catch (err) {
      log.error({ err, sessionKey, modelId: targetModelId }, 'Failed to apply model');
    }
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

        // Execute the prompt
        await agent.prompt(userMessage);
        await agent.waitForIdle();

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

        // Don't fallback on user abort
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }

        if (isFailoverError(err)) {
          const described = describeFailoverError(err);
          log.warn(
            { provider: candidate.provider, model: candidate.model, ...described },
            'Model call failed, trying fallback'
          );
        } else {
          log.warn(
            { provider: candidate.provider, model: candidate.model, error: err },
            'Model call failed with non-failover error'
          );
        }

        // Continue to next candidate
        continue;
      }
    }

    // All models failed
    if (lastError) {
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
    return getAvailableModels(this.config);
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
