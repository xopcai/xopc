/**
 * Configuration hot reload manager
 */

import { watch, type FSWatcher } from 'fs';
import { loadConfig } from './loader.js';
import type { Config } from './schema.js';
import { diffConfigPaths } from './diff.js';
import { buildReloadPlan, type ReloadPlan } from './rules.js';
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
export interface ReloadCallbacks {
  onProvidersReload?: (newConfig: Config) => void;
  onAgentDefaultsReload?: (newConfig: Config) => void;
  onChannelsReload?: (newConfig: Config) => void;
  onCronReload?: (newConfig: Config) => void;
  onHeartbeatReload?: (newConfig: Config) => void;
  onToolsReload?: (newConfig: Config) => void;
  onWebSearchReload?: (newConfig: Config) => void;
  onFullRestart?: (newConfig: Config) => void;
}

/**
 * Configuration hot reload manager
 */
export class ConfigHotReloader {
  private configPath: string;
  private callbacks: ReloadCallbacks;
  private watcher: FSWatcher | null = null;
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
  }

  /**
   * Stop watching config file
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
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
      log.error({ err }, 'Failed to reload config');
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

    // Handle hot reload changes
    if (plan.requiresHotReload) {
      for (const path of plan.hotPaths) {
        await this.applyHotPath(path, newConfig);
      }
    }

    log.info({ plan }, 'Config hot reload completed');
  }

  /**
   * Apply a single hot-reloadable path
   */
  private async applyHotPath(path: string, newConfig: Config): Promise<void> {
    if (path.startsWith('providers.')) {
      if (this.callbacks.onProvidersReload) {
        this.callbacks.onProvidersReload(newConfig);
      }
      return;
    }

    if (path.startsWith('agents.defaults.')) {
      if (this.callbacks.onAgentDefaultsReload) {
        this.callbacks.onAgentDefaultsReload(newConfig);
      }
      return;
    }

    if (path.startsWith('channels.')) {
      if (this.callbacks.onChannelsReload) {
        this.callbacks.onChannelsReload(newConfig);
      }
      return;
    }

    if (path.startsWith('cron.')) {
      if (this.callbacks.onCronReload) {
        this.callbacks.onCronReload(newConfig);
      }
      return;
    }

    if (path.startsWith('heartbeat.')) {
      if (this.callbacks.onHeartbeatReload) {
        this.callbacks.onHeartbeatReload(newConfig);
      }
      return;
    }

    if (path.startsWith('tools.')) {
      if (this.callbacks.onToolsReload) {
        this.callbacks.onToolsReload(newConfig);
      }
      return;
    }

    if (path.startsWith('webSearch.') || path.startsWith('webTools.')) {
      if (this.callbacks.onWebSearchReload) {
        this.callbacks.onWebSearchReload(newConfig);
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
