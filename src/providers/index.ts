/**
 * Provider Module
 * 
 * LLM provider implementations.
 * 
 * Architecture:
 * - models.json: Built-in model definitions ()
 * - modelssingle source of truth-loader.ts: Unified model registry loader
 * - registry.ts: Model registration and management
 * - auto-discovery.ts: Provider auto-discovery
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
	registerOAuthRefresh,
	type ProviderOverride,
	type ProviderInfo,
} from './registry.js';

// Unified model loader exports (single source of truth)
export {
	getManifest,
	getManifestVersion,
	buildRegistry,
	getAllModels,
	getConfiguredModels,
	getProvider,
	getModel,
	isProviderConfigured,
	getAllProviderIds,
	getConfiguredProviderIds,
	type ModelsManifest,
	type ResolvedModel,
	type ResolvedProvider,
	type ProviderEntry,
	type ModelEntry,
} from './models-loader.js';

// Auto Discovery exports
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
