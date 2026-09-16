/**
 * Model management module
 * 
 * Handles model selection, switching, and automatic fallback
 * when a provider fails.
 */

import { Agent } from '@earendil-works/pi-agent-core';
import type { Model, Api } from '@earendil-works/pi-ai';
import { type Config, getAgentDefaultModelRef } from '../../config/schema.js';
import { createLogger } from '../../utils/logger.js';
import { resolveModel, getAllModels as getAllModelsFromProviders, getDefaultModelSync } from '../../providers/index.js';
import { resolveFallbackCandidates, type ModelCandidate } from '../fallback/candidates.js';
import { parseModelRef } from './selection.js';

const log = createLogger('ModelManager');

export interface ModelManagerConfig {
  defaultModel?: string;
  config?: Config;
}

export class ModelManager {
  private defaultModel: string;
  private config?: Config;
  private currentModelName: string;
  private currentProvider: string;
  private sessionModels: Map<string, string> = new Map();
  private fixedSessionModels = new Set<string>();
  /** Baseline model from `agents.list` / defaults merge when the session agent is created. */
  private sessionProfileDefaults: Map<string, string> = new Map();
  private sessionProfileFallbacks: Map<string, string[]> = new Map();

  constructor(config: ModelManagerConfig = {}) {
    this.config = config.config;
    this.defaultModel = config.defaultModel || getDefaultModelSync(config.config);
    this.currentModelName = this.defaultModel;
    this.currentProvider = this.defaultModel.split('/')[0] || 'anthropic';
  }

  /**
   * Apply updated config so default model and failover metadata match disk/runtime config.
   */
  updateFromConfig(config: Config): void {
    this.config = config;
    const ref = getAgentDefaultModelRef(config);
    this.defaultModel = ref ? ref : getDefaultModelSync(config);
    this.sessionProfileDefaults.clear();
    this.sessionProfileFallbacks.clear();
  }

  /**
   * Set the config-derived default model for a session (from effective agent profile).
   * Cleared by {@link updateFromConfig} or {@link clearSessionProfileDefault}.
   */
  setSessionProfileDefault(conversationId: string, modelRef: string, fallbacks: string[] = []): void {
    this.sessionProfileDefaults.set(conversationId, modelRef);
    const cleanFallbacks = fallbacks.map((ref) => ref.trim()).filter(Boolean);
    if (cleanFallbacks.length > 0) {
      this.sessionProfileFallbacks.set(conversationId, cleanFallbacks);
    } else {
      this.sessionProfileFallbacks.delete(conversationId);
    }
  }

  /**
   * Register the profile model and return the model that should initialize the
   * session agent. An existing per-session override always wins.
   */
  resolveInitialModelForSession(
    conversationId: string,
    profileModelRef: string,
    fallbacks: string[] = [],
  ): string {
    this.setSessionProfileDefault(conversationId, profileModelRef, fallbacks);
    return this.getModelForSession(conversationId);
  }

  clearSessionProfileDefault(conversationId: string): void {
    this.sessionProfileDefaults.delete(conversationId);
    this.sessionProfileFallbacks.delete(conversationId);
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
  async switchModelForSession(conversationId: string, modelId: string): Promise<boolean> {
    try {
      resolveModel(modelId);
      this.sessionModels.set(conversationId, modelId);
      log.info({ conversationId, modelId }, 'Model switched for session');
      return true;
    } catch (err) {
      log.error({ err, conversationId, modelId }, 'Failed to switch model');
      return false;
    }
  }

  /** Restore persisted identity even if its provider is temporarily unavailable. */
  restoreSessionModel(conversationId: string, modelRef: string, fixed: boolean): void {
    this.sessionModels.set(conversationId, modelRef);
    if (fixed) this.fixedSessionModels.add(conversationId);
    else this.fixedSessionModels.delete(conversationId);
  }

  /** Drop in-memory session override so the global default is used again. */
  clearSessionModelOverride(conversationId: string): void {
    this.sessionModels.delete(conversationId);
    this.fixedSessionModels.delete(conversationId);
  }

  /**
   * Resolved pi-ai model for session (for transcript policy, tools, etc.)
   */
  getResolvedModelForSession(conversationId: string): Model<Api> {
    return resolveModel(this.getModelForSession(conversationId));
  }

  /**
   * Get model for session, checking session override first
   */
  getModelForSession(conversationId: string): string {
    const sessionModel = this.sessionModels.get(conversationId);
    if (sessionModel) {
      return sessionModel;
    }

    const profileDefault = this.sessionProfileDefaults.get(conversationId);
    if (profileDefault) {
      return profileDefault;
    }

    return this.defaultModel;
  }

  /**
   * Apply model to agent if different from current
   */
  async applyModelForSession(agent: Agent, conversationId: string): Promise<void> {
    const targetModelId = this.getModelForSession(conversationId);

    let found: Model<Api>;
    try {
      found = resolveModel(targetModelId);
    } catch (err) {
      log.error({ err, conversationId, modelId: targetModelId }, 'Failed to apply model');
      return;
    }

    const sm = agent.state.model as Model<Api> | undefined;
    if (sm && sm.provider === found.provider && sm.id === found.id) {
      this.currentModelName = targetModelId;
      this.currentProvider = found.provider || 'unknown';
      return;
    }

    agent.state.model = found;
    this.currentModelName = targetModelId;
    this.currentProvider = found.provider || 'unknown';

    log.info({ conversationId, modelId: targetModelId }, 'Applied model for session');
  }

  /**
   * Ordered model candidates for the session.
   */
  getFallbackCandidatesForSession(conversationId: string): ModelCandidate[] {
    const ref = this.getModelForSession(conversationId);
    const parsed = parseModelRef(ref);
    if (!parsed) {
      return [];
    }
    if (this.fixedSessionModels.has(conversationId)) return [parsed];
    return resolveFallbackCandidates({
      cfg: this.config,
      provider: parsed.provider,
      model: parsed.model,
      fallbacksOverride: this.sessionModels.has(conversationId)
        ? undefined
        : this.sessionProfileFallbacks.get(conversationId),
    });
  }

  /**
   * Apply a resolved pi-ai model and sync {@link currentModelName} / {@link currentProvider}.
   */
  applyResolvedModel(agent: Agent, model: Model<Api>, modelRef: string): void {
    agent.state.model = model;
    this.currentModelName = modelRef;
    this.currentProvider = model.provider || 'unknown';
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
