/**
 * xopcbot Extension System
 * 
 * @module extensions
 */

// Core Types
export * from './types/index.js';

// Extension API
export { ExtensionApiImpl, createExtensionLogger, createPathResolver } from './api.js';

// Extension Loader and Registry
export { ExtensionRegistryImpl, ExtensionLoader, normalizeExtensionConfig, resolveExtensionPath } from './loader.js';
export type { ExtensionRegistry } from './types/core.js';

// Hook System
export { ExtensionHookRunner, createHookContext, isHookEvent } from './hooks.js';
