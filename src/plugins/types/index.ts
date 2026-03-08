/**
 * Plugin System - Type Exports
 * 
 * Central export point for all plugin types.
 */

// Re-export everything from submodules
export * from './core.js';
export * from './tools.js';
export * from './hooks.js';
export * from './events.js';
export * from './channels.js';
export * from './loader.js';
// Phase 4 re-exports (PluginLogger already exported from core)
export type { ProviderConfig, ProviderApiType, ModelConfig, OAuthConfig, OAuthCallbacks, OAuthCredentials, FlagConfig, FlagValue, ShortcutConfig, ShortcutHandler } from './phase4.js';
