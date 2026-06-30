/**
 * Configuration hot reload manager
 */

import { watch, type FSWatcher } from 'fs';
import { loadConfig } from './loader.js';
import type { Config } from './schema.js';
import { diffConfigPaths } from './diff.js';
import { buildReloadPlan, type ReloadPlan } from './rules.js';
import { resolveModelsJsonPath } from './paths.js';
import { logger as log } from '../utils/logger.js';

export interface HotReloadConfig {
  debounceMs: number;
  enabled: boolean;
}

export interface ReloadResult {
  success: boolean;
  plan?: ReloadPlan;
  error?: string;
}

/**
 * Callback types for different reload actions
 */
export type ReloadCallback = (newConfig: Config) => void | Promise<void>;

export interface ReloadCallbacks {
  onModelsReload?: ReloadCallback;
  onAgentDefaultsReload?: ReloadCallback;
  onChannelsReload?: ReloadCallback;
  onCronReload?: ReloadCallback;
  onHeartbeatReload?: ReloadCallback;
  onToolsReload?: ReloadCallback;
  onMcpReload?: ReloadCallback;
  onWebSearchReload?: ReloadCallback;
  /** All `extensions.*` hot paths in one batch (deduplicated in applyReload). */
  onExtensionsReload?: (
    newConfig: Config,
    changedPaths: string[],
  ) => void | Promise<void>;
  onFullRestart?: ReloadCallback;
}

/**
 * Configuration hot reload manager
 */
export class ConfigHotReloader {
  private configPath: string;
  private callbacks: ReloadCallbacks;
  private watcher: FSWatcher | null = null;
  private modelsJsonWatcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentConfig: Config;
  private debounceMs: number;
  private enabled: boolean;

  constructor(
    configPath: string,
    initialConfig: Config,
    callbacks: ReloadCallbacks,
    options: HotReloadConfig = { debounceMs: 300, enabled: true }
  ) {
    this.configPath = configPath;
    this.currentConfig = initialConfig;
    this.callbacks = callbacks;
    this.debounceMs = options.debounceMs;
    this.enabled = options.enabled;
  }

  /**
   * Start watching config file for changes
   */
  start(): void {
    if (!this.enabled) {
      log.info('Config hot reload disabled');
      return;
    }

    try {
      this.watcher = watch(this.configPath, (eventType) => {
        if (eventType === 'change') {
          this.scheduleReload();
        }
      });
      log.info({ path: this.configPath }, 'Config hot reload enabled');
    } catch (err) {
      log.error({ err }, 'Failed to setup config watcher');
    }

    this.startModelsJsonWatcher();
  }

  /**
   * Stop watching config file
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.modelsJsonWatcher) {
      this.modelsJsonWatcher.close();
      this.modelsJsonWatcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    log.info('Config hot reload stopped');
  }

  /**
   * Schedule a reload with debounce
   */
  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      void this.reload();
    }, this.debounceMs);
  }

  /**
   * Watch models.json independently so direct file edits are picked up without restarting.
   * The watcher is best-effort: if the file does not exist yet, it will not be watched.
   */
  private startModelsJsonWatcher(): void {
    const modelsJsonPath = resolveModelsJsonPath();
    try {
      this.modelsJsonWatcher = watch(modelsJsonPath, (eventType) => {
        if (eventType === 'change') {
          this.scheduleModelsJsonReload();
        }
      });
      log.info({ path: modelsJsonPath }, 'models.json hot reload enabled');
    } catch {
      log.debug({ path: modelsJsonPath }, 'models.json not found, skipping watcher');
    }
  }

  /**
   * Debounced handler for models.json changes.
   * Calls onModelsReload with the current config so the registry is refreshed.
   */
  private scheduleModelsJsonReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      log.info('models.json changed on disk — refreshing ModelRegistry');
      if (this.callbacks.onModelsReload) {
        void Promise.resolve(this.callbacks.onModelsReload(this.currentConfig));
      }
    }, this.debounceMs);
  }

  /**
   * Reload configuration and apply changes
   */
  async reload(): Promise<ReloadResult> {
    try {
      log.info('Reloading configuration...');
      
      // Load new config
      const newConfig = loadConfig(this.configPath);
      
      // Diff with current config
      const changedPaths = diffConfigPaths(this.currentConfig, newConfig);
      
      if (changedPaths.length === 0) {
        log.debug('No config changes detected');
        return { success: true };
      }
      
      log.info({ changedPaths }, 'Config changes detected');
      
      // Build reload plan
      const plan = buildReloadPlan(changedPaths);
      
      // Apply changes based on plan
      await this.applyReload(plan, newConfig);
      
      // Update current config
      this.currentConfig = newConfig;
      
      return { success: true, plan };
      
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ err, configPath: this.configPath, errorMessage: error }, `Config hot reload failed: ${error}`);
      return { success: false, error };
    }
  }

  /**
   * Apply reload based on plan
   */
  private async applyReload(plan: ReloadPlan, newConfig: Config): Promise<void> {
    // Handle restart-required changes first
    if (plan.requiresRestart) {
      log.info(
        { restartPaths: plan.restartPaths },
        'Config changes require gateway restart'
      );
      
      if (this.callbacks.onFullRestart) {
        this.callbacks.onFullRestart(newConfig);
      }
      return;
    }

    if (!plan.requiresHotReload) {
      log.info({ plan }, 'Config hot reload completed');
      return;
    }

    const isExtensionPath = (p: string) => p === 'extensions' || p.startsWith('extensions.');
    const extensionPaths = plan.hotPaths.filter(isExtensionPath);
    const otherPaths = plan.hotPaths.filter((p) => !isExtensionPath(p));

    for (const path of otherPaths) {
      await this.applyHotPath(path, newConfig);
    }

    if (extensionPaths.length > 0 && this.callbacks.onExtensionsReload) {
      await Promise.resolve(this.callbacks.onExtensionsReload(newConfig, extensionPaths));
    }

    log.info({ plan }, 'Config hot reload completed');
  }

  /**
   * Apply a single hot-reloadable path
   */
  private async applyHotPath(path: string, newConfig: Config): Promise<void> {
    if (path.startsWith('models.')) {
      if (this.callbacks.onModelsReload) {
        await Promise.resolve(this.callbacks.onModelsReload(newConfig));
      }
      return;
    }

    if (path.startsWith('agents.list') || path.startsWith('agents.capabilityPresets')) {
      if (this.callbacks.onAgentDefaultsReload) {
        await Promise.resolve(this.callbacks.onAgentDefaultsReload(newConfig));
      }
      return;
    }

    if (path.startsWith('channels.')) {
      if (this.callbacks.onChannelsReload) {
        await Promise.resolve(this.callbacks.onChannelsReload(newConfig));
      }
      return;
    }

    if (path.startsWith('cron.')) {
      if (this.callbacks.onCronReload) {
        await Promise.resolve(this.callbacks.onCronReload(newConfig));
      }
      return;
    }

    if (path === 'gateway.heartbeat' || path.startsWith('gateway.heartbeat.')) {
      if (this.callbacks.onHeartbeatReload) {
        await Promise.resolve(this.callbacks.onHeartbeatReload(newConfig));
      }
      return;
    }

    if (path.startsWith('tools.')) {
      if (this.callbacks.onToolsReload) {
        await Promise.resolve(this.callbacks.onToolsReload(newConfig));
      }
      return;
    }

    if (path.startsWith('mcp.') || path === 'mcp') {
      if (this.callbacks.onMcpReload) {
        await Promise.resolve(this.callbacks.onMcpReload(newConfig));
      }
      return;
    }

    if (path.startsWith('webSearch.') || path.startsWith('webTools.')) {
      if (this.callbacks.onWebSearchReload) {
        await Promise.resolve(this.callbacks.onWebSearchReload(newConfig));
      }
      return;
    }

    log.debug({ path }, 'No handler for hot reload path');
  }

  /**
   * Manually trigger a reload
   */
  async triggerReload(): Promise<ReloadResult> {
    return this.reload();
  }

  /**
   * Align diff baseline with a freshly loaded config (e.g. Weixin QR wrote token files but JSON unchanged).
   */
  syncCurrentConfig(config: Config): void {
    this.currentConfig = config;
  }

  /**
   * Get current config
   */
  getConfig(): Config {
    return this.currentConfig;
  }

  /**
   * Check if hot reload is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

export { diffConfigPaths } from './diff.js';
export { buildReloadPlan, matchReloadRule, BASE_RELOAD_RULES } from './rules.js';
