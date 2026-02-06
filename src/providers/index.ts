/**
 * Provider Module
 * 
 * LLM provider implementations.
 * 
 * New Architecture (ModelRegistry):
 * - registry.ts: Model registration and management
 * - pi-ai.ts: Legacy adapter (still supported)
 */

export { LLMProviderImpl, createProvider, getAvailableModels } from './pi-ai.js';
export type { LLMProvider } from './pi-ai.js';

// New ModelRegistry-based exports
export { ModelRegistry, getApiKey, saveApiKey, resolveConfigValue } from './registry.js';
export type { ModelConfig, ProviderConfig, ModelsConfig } from './registry.js';
