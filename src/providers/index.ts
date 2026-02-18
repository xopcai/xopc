/**
 * Provider Module
 * 
 * LLM provider implementations.
 * 
 * New Architecture (ModelRegistry):
 * - registry.ts: Model registration and management
 * - pi-ai.ts: Unified provider adapter with strict types
 * - api-strategies.ts: Provider-specific API option builders
 * - config.ts: Centralized provider configuration
 * 
 * Auth Profiles:
 * - auth/profiles/: Advanced credential management with OAuth support
 */

// Core exports
export { LLMProviderImpl, createProvider, getAvailableModels, listAllModels } from './pi-ai.js';
export type { LLMProvider } from './pi-ai.js';

// ModelRegistry exports
export {
	ModelRegistry,
	resolveConfigValue,
	PROVIDER_INFO,
	registerOAuthRefresh,
	type ProviderOverride,
	type ProviderInfo,
} from './registry.js';

// New strict types
export type {
	ChatMessage,
	ChatOptions,
	ChatResponse,
	ToolCall,
	ContentPart,
	TextContent,
	ImageContent,
	ApiType,
	ApiStrategyOptions,
	FinishReason,
	TokenUsage,
} from './types.js';

// API strategies
export { getApiStrategy, buildProviderOptions } from './api-strategies.js';

// Configuration
export {
	createProviderConfig,
	loadProviderConfigFromEnv,
	DEFAULT_PROVIDER_CONFIG,
	type ProviderBehaviorConfig,
} from './config.js';
