/**
 * Plugin Registry - Unified registry for providers, flags, and shortcuts
 *
 * Consolidates Phase 4 features into a single, cohesive registry.
 * Reduces code duplication and simplifies the plugin API.
 */

import type {
  ProviderConfig,
  ModelConfig,
  FlagConfig,
  FlagValue,
  ShortcutConfig,
  ShortcutHandler,
} from './types/phase4.js';
import type { PluginLogger } from './types/core.js';

// ============================================================================
// Provider Management
// ============================================================================

interface ProviderEntry {
  name: string;
  config: ProviderConfig;
  models: Map<string, ModelConfig>;
  isOverridingBuiltIn: boolean;
  originalConfig?: ProviderConfig;
  pluginId?: string;
}

// ============================================================================
// Flag Management
// ============================================================================

interface FlagEntry {
  name: string;
  config: FlagConfig;
  value: FlagValue;
  pluginId?: string;
}

// ============================================================================
// Shortcut Management
// ============================================================================

interface ShortcutEntry {
  key: string;
  config: ShortcutConfig;
  handler: ShortcutHandler;
  pluginId?: string;
}

// ============================================================================
// Unified Plugin Registry
// ============================================================================

export interface PluginRegistryOptions {
  logger?: PluginLogger;
}

export class PluginRegistry {
  private providers = new Map<string, ProviderEntry>();
  private flags = new Map<string, FlagEntry>();
  private flagAliases = new Map<string, string>();
  private shortcuts = new Map<string, ShortcutEntry>();
  private builtinShortcuts = new Set<string>();
  private logger: PluginLogger;

  constructor(options: PluginRegistryOptions = {}) {
    this.logger = options.logger ?? this.createDefaultLogger();
  }

  // ============================================================================
  // Provider Methods
  // ============================================================================

  registerProvider(name: string, config: Partial<ProviderConfig>, pluginId?: string): void {
    const existing = this.providers.get(name);

    if (existing) {
      this.logger.info(`Updating provider: ${name}`);
      existing.config = this.mergeConfig(existing.config, config);

      if (config.models) {
        for (const model of config.models) {
          existing.models.set(model.id, model);
        }
      }
    } else {
      if (config.models && config.models.length > 0 && !config.baseUrl) {
        throw new Error(`Provider ${name}: baseUrl is required when defining models`);
      }

      const entry: ProviderEntry = {
        name,
        config: config as ProviderConfig,
        models: new Map(),
        isOverridingBuiltIn: false,
        pluginId,
      };

      if (config.models) {
        for (const model of config.models) {
          entry.models.set(model.id, model);
        }
      }

      this.providers.set(name, entry);
      this.logger.info(`Registered provider: ${name}`);
    }
  }

  unregisterProvider(name: string): void {
    if (this.providers.delete(name)) {
      this.logger.info(`Unregistered provider: ${name}`);
    }
  }

  getProvider(name: string): ProviderConfig | undefined {
    const entry = this.providers.get(name);
    if (!entry) return undefined;

    return {
      ...entry.config,
      models: Array.from(entry.models.values()),
    };
  }

  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  getAllProviders(): Record<string, ProviderConfig> {
    const result: Record<string, ProviderConfig> = {};
    for (const [name, entry] of this.providers.entries()) {
      result[name] = {
        ...entry.config,
        models: Array.from(entry.models.values()),
      };
    }
    return result;
  }

  getModels(providerName: string): ModelConfig[] {
    const entry = this.providers.get(providerName);
    return entry ? Array.from(entry.models.values()) : [];
  }

  private mergeConfig(base: ProviderConfig, updates: Partial<ProviderConfig>): ProviderConfig {
    return {
      ...base,
      ...updates,
      models: updates.models ?? base.models,
    };
  }

  // ============================================================================
  // Flag Methods
  // ============================================================================

  registerFlag(name: string, config: FlagConfig, pluginId?: string): void {
    if (!name.match(/^[a-zA-Z][a-zA-Z0-9-]*$/)) {
      throw new Error(`Invalid flag name: ${name}`);
    }

    if (this.flags.has(name)) {
      throw new Error(`Flag already registered: ${name}`);
    }

    if (config.aliases) {
      for (const alias of config.aliases) {
        if (this.flagAliases.has(alias)) {
          throw new Error(`Flag alias already in use: ${alias}`);
        }
      }
    }

    const value = config.default ?? (config.type === 'boolean' ? false : undefined);

    const entry: FlagEntry = {
      name,
      config,
      value,
      pluginId,
    };

    this.flags.set(name, entry);

    if (config.aliases) {
      for (const alias of config.aliases) {
        this.flagAliases.set(alias, name);
      }
    }

    this.logger.debug(`Registered flag: ${name}`);
  }

  parseArgs(args: string[]): void {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg.startsWith('-')) continue;

      const flagName = this.resolveFlagName(arg);
      if (!flagName) {
        this.logger.warn(`Unknown flag: ${arg}`);
        continue;
      }

      const entry = this.flags.get(flagName);
      if (!entry) continue;

      if (entry.config.type === 'boolean') {
        entry.value = true;
      } else {
        const value = args[++i];
        if (value === undefined || value.startsWith('-')) {
          this.logger.warn(`Missing value for flag: ${arg}`);
          continue;
        }
        entry.value = value;
      }
    }
  }

  getFlag<T extends FlagValue = FlagValue>(name: string): T | undefined {
    const entry = this.flags.get(name);
    return (entry?.value as T) ?? (entry?.config.default as T);
  }

  getAllFlags(): Record<string, FlagValue> {
    const result: Record<string, FlagValue> = {};
    for (const [name, entry] of this.flags.entries()) {
      result[name] = entry.value ?? entry.config.default;
    }
    return result;
  }

  private resolveFlagName(arg: string): string | undefined {
    // Try exact match first
    if (this.flags.has(arg)) return arg;
    
    // Try aliases
    const aliased = this.flagAliases.get(arg);
    if (aliased) return aliased;
    
    // Strip leading dashes for flags like --verbose -> verbose
    const stripped = arg.replace(/^-+/, '');
    if (this.flags.has(stripped)) return stripped;
    if (this.flagAliases.has(stripped)) return this.flagAliases.get(stripped);
    
    return undefined;
  }

  // ============================================================================
  // Shortcut Methods
  // ============================================================================

  registerShortcut(
    key: string,
    config: ShortcutConfig,
    options: { pluginId?: string } = {}
  ): void {
    const normalizedKey = this.normalizeKey(key);

    if (this.shortcuts.has(normalizedKey)) {
      const existing = this.shortcuts.get(normalizedKey)!;
      if (this.builtinShortcuts.has(normalizedKey)) {
        this.logger.warn(
          `Shortcut '${key}' conflicts with built-in '${existing.config.description}'. Plugin override takes precedence.`
        );
      } else {
        throw new Error(
          `Shortcut conflict: '${key}' is already registered by '${existing.pluginId ?? 'unknown'}'`
        );
      }
    }

    const entry: ShortcutEntry = {
      key: normalizedKey,
      config,
      handler: config.handler,
      pluginId: options.pluginId,
    };

    this.shortcuts.set(normalizedKey, entry);
    this.logger.debug(`Registered shortcut: ${key} -> ${config.description}`);
  }

  registerBuiltinShortcut(key: string, action: string): void {
    const normalizedKey = this.normalizeKey(key);
    this.builtinShortcuts.add(normalizedKey);
    this.logger.debug(`Registered built-in shortcut: ${key} -> ${action}`);
  }

  async executeShortcut(key: string, context: unknown): Promise<boolean> {
    const normalizedKey = this.normalizeKey(key);
    const entry = this.shortcuts.get(normalizedKey);

    if (!entry) return false;

    try {
      await entry.handler(context);
      return true;
    } catch (error) {
      this.logger.error(`Error executing shortcut ${key}: ${error}`);
      return false;
    }
  }

  hasShortcut(key: string): boolean {
    return this.shortcuts.has(this.normalizeKey(key));
  }

  getShortcuts(): Array<{ key: string; description: string }> {
    return Array.from(this.shortcuts.values()).map((entry) => ({
      key: entry.key,
      description: entry.config.description,
    }));
  }

  private normalizeKey(key: string): string {
    return key.toLowerCase().replace(/\s+/g, '');
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  cleanup(pluginId?: string): void {
    if (!pluginId) {
      // Clear all if no pluginId provided
      this.providers.clear();
      this.flags.clear();
      this.flagAliases.clear();
      this.shortcuts.clear();
      this.builtinShortcuts.clear();
    } else {
      for (const [name, entry] of this.providers.entries()) {
        if (entry.pluginId === pluginId) {
          this.providers.delete(name);
        }
      }

      for (const [name, entry] of this.flags.entries()) {
        if (entry.pluginId === pluginId) {
          this.flags.delete(name);
        }
      }

      for (const [key, entry] of this.shortcuts.entries()) {
        if (entry.pluginId === pluginId) {
          this.shortcuts.delete(key);
        }
      }
    }

    this.logger.debug(`Cleaned up plugin resources: ${pluginId ?? 'all'}`);
  }

  // ============================================================================
  // Logger
  // ============================================================================

  private createDefaultLogger(): PluginLogger {
    const prefix = '[PluginRegistry]';
    return {
      debug: (msg) => console.debug(prefix, msg),
      info: (msg) => console.info(prefix, msg),
      warn: (msg) => console.warn(prefix, msg),
      error: (msg) => console.error(prefix, msg),
    };
  }
}
