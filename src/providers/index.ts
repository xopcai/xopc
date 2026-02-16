/**
 * Provider Module
 * 
 * LLM provider implementations.
 * 
 * New Architecture (ModelRegistry):
 * - registry.ts: Model registration and management
 * - pi-ai.ts: Legacy adapter (still supported)
 * 
 * Auth Profiles:
 * - auth/profiles/: Advanced credential management with OAuth support
 */

export { LLMProviderImpl, createProvider, getAvailableModels, listAllModels } from './pi-ai.js';
export type { LLMProvider } from './pi-ai.js';

// New ModelRegistry-based exports
export {
	ModelRegistry,
	resolveConfigValue,
	PROVIDER_INFO,
	registerOAuthRefresh,
	type ProviderOverride,
	type ProviderInfo,
} from './registry.js';
