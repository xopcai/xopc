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
  setSessionProfileDefault(sessionKey: string, modelRef: string, fallbacks: string[] = []): void {
    this.sessionProfileDefaults.set(sessionKey, modelRef);
    const cleanFallbacks = fallbacks.map((ref) => ref.trim()).filter(Boolean);
    if (cleanFallbacks.length > 0) {
      this.sessionProfileFallbacks.set(sessionKey, cleanFallbacks);
    } else {
      this.sessionProfileFallbacks.delete(sessionKey);
    }
  }

  /**
   * Register the profile model and return the model that should initialize the
   * session agent. An existing per-session override always wins.
   */
  resolveInitialModelForSession(
    sessionKey: string,
    profileModelRef: string,
    fallbacks: string[] = [],
  ): string {
    this.setSessionProfileDefault(sessionKey, profileModelRef, fallbacks);
    return this.getModelForSession(sessionKey);
  }

  clearSessionProfileDefault(sessionKey: string): void {
    this.sessionProfileDefaults.delete(sessionKey);
    this.sessionProfileFallbacks.delete(sessionKey);
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
    const sessionModel = this.sessionModels.get(sessionKey);
    if (sessionModel) {
      return sessionModel;
    }

    const profileDefault = this.sessionProfileDefaults.get(sessionKey);
    if (profileDefault) {
      return profileDefault;
    }

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

    agent.state.model = found;
    this.currentModelName = targetModelId;
    this.currentProvider = found.provider || 'unknown';

    log.info({ sessionKey, modelId: targetModelId }, 'Applied model for session');
  }

  /**
   * Ordered model candidates for the session.
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
      fallbacksOverride: this.sessionModels.has(sessionKey)
        ? undefined
        : this.sessionProfileFallbacks.get(sessionKey),
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
