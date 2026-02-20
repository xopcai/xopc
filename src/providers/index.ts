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
 * - provider-catalog.ts: Unified provider definitions
 * - model-catalog.ts: Model capabilities system
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

// ============================================
// Provider Catalog
// ============================================
export {
	// Core
	PROVIDER_CATALOG,
	getProvider,
	getAllProviders,
	
	// Detection & Configuration
	detectProviderByModel,
	isProviderConfigured,
	getConfiguredProviders,
	getProviderApiKey,
	
	// Display
	getProviderDisplayInfo,
	getAllProviderDisplayInfo,
	
	// Model reference parsing
	parseModelRef,
	registerCustomProvider,
	createCustomProviderFromConfig,
	
	// Types
	type ProviderDefinition,
	type ProviderAuth,
	type ProviderApi,
	type ProviderCapabilities,
	type ProviderDefaults,
	type ProviderCategory,
	type AuthType,
	type ParsedModelRef,
} from './provider-catalog.js';

// ============================================
// Auto Discovery
// ============================================
export {
	scanProviders,
	recommendDefaultModel,
	generateAutoConfig,
	generateConfigTemplate,
	quickSetup,
	isModelAvailable,
	getBestAvailableModel,
	printDiagnostic,
	getConfigSummary,
	type DiscoveredProvider,
	type AutoConfig,
	type QuickSetupResult,
} from './auto-discovery.js';

// ============================================
// Model Catalog
// ============================================
export {
	// Core
	MODEL_CATALOG,
	getAllModels,
	findModel,
	findModelByProvider,
	findModelByRef,
	getModelsByProvider,
	
	// Recommendations
	getRecommendedModels,
	getModelsForTask,
	
	// Capabilities
	getModelsByCapability,
	getModelsByModality,
	getVisionModels,
	getFunctionCallingModels,
	modelSupportsModality,
	modelSupportsFeature,
	
	// Pricing & Performance
	estimateCost,
	getModelComparisonInfo,
	
	// Utilities
	getFullModelRef,
	parseModelReference,
	registerCustomModel,
	
	// Types
	type ModelDefinition,
	type ModelFeatures,
	type ModelLimits,
	type ModelPricing,
	type ModelPerformance,
	type Modality,
	type TaskType,
	type ModelComparisonInfo,
} from './model-catalog.js';
