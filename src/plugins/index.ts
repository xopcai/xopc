/**
 * xopcbot Plugin System
 * 
 * A lightweight plugin system inspired by OpenClaw.
 * 
 * @module plugins
 */

// Core Types
export * from './types.js';

// Plugin API
export { PluginApiImpl, createPluginLogger, createPathResolver } from './api.js';

// Plugin Loader and Registry
export { PluginRegistryImpl, PluginLoader, normalizePluginConfig, resolvePluginPath } from './loader.js';

// Hook System
export { HookRunner, createHookContext, isHookEvent } from './hooks.js';
