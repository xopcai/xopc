/**
 * Model Registry - manages built-in and custom models from models.json
 * 
 * Features:
 * - Loads built-in models from @mariozechner/pi-ai
 * - Loads custom models from ~/.xopcbot/models.json
 * - Supports provider baseUrl/headers overrides
 * - Supports per-model overrides (modelOverrides)
 * - API key resolution with shell commands, env vars, and literals
 * - Hot reload support
 */

import {
	type Api,
	getModels as getPiAiModels,
	getProviders as getPiAiProviders,
	type Model,
	type KnownProvider,
} from '@mariozechner/pi-ai';
import { existsSync, readFileSync } from 'fs';
import { resolveConfigValue, resolveHeaders } from '../config/resolve-config-value.js';
import { getModelsJsonPath } from '../config/paths.js';
import type {
	ModelsJsonConfig,
	ModelOverride,
} from '../config/models-json.js';
import { validateModelsConfig, getDefaultModelValues } from '../config/models-json.js';
import { createLogger } from '../utils/logger.js';
import { getApiKeyFromEnv } from './index.js';

const log = createLogger('ModelRegistry');

/** Provider override config (baseUrl, headers, apiKey) without custom models */
interface ProviderOverride {
	baseUrl?: string;
	headers?: Record<string, string>;
	apiKey?: string;
}

/** Result of loading custom models from models.json */
interface CustomModelsResult {
	models: Model<Api>[];
	/** Providers with baseUrl/headers/apiKey overrides for built-in models */
	overrides: Map<string, ProviderOverride>;
	/** Per-model overrides: provider -> modelId -> override */
	modelOverrides: Map<string, Map<string, ModelOverride>>;
	/** Custom provider API key configs for fallback resolution */
	apiKeyConfigs: Map<string, string>;
	error: string | undefined;
}

function emptyCustomModelsResult(error?: string): CustomModelsResult {
	return {
		models: [],
		overrides: new Map(),
		modelOverrides: new Map(),
		apiKeyConfigs: new Map(),
		error,
	};
}

/**
 * Deep merge compat settings
 */
function mergeCompat(
	baseCompat: Model<Api>['compat'],
	overrideCompat: ModelOverride['compat'],
): Model<Api>['compat'] | undefined {
	if (!overrideCompat) return baseCompat;

	const base = baseCompat as Record<string, unknown> | undefined;
	const override = overrideCompat as Record<string, unknown>;
	const merged = { ...base, ...override } as Record<string, unknown>;

	// Deep merge nested routing objects
	const baseCompletions = base as { openRouterRouting?: unknown; vercelGatewayRouting?: unknown } | undefined;
	const overrideCompletions = override as { openRouterRouting?: unknown; vercelGatewayRouting?: unknown };

	if (baseCompletions?.openRouterRouting || overrideCompletions?.openRouterRouting) {
		(merged as { openRouterRouting: unknown }).openRouterRouting = {
			...((baseCompletions?.openRouterRouting as object) || {}),
			...((overrideCompletions?.openRouterRouting as object) || {}),
		};
	}

	if (baseCompletions?.vercelGatewayRouting || overrideCompletions?.vercelGatewayRouting) {
		(merged as { vercelGatewayRouting: unknown }).vercelGatewayRouting = {
			...((baseCompletions?.vercelGatewayRouting as object) || {}),
			...((overrideCompletions?.vercelGatewayRouting as object) || {}),
		};
	}

	return merged as Model<Api>['compat'];
}

/**
 * Apply a model override to a model
 */
function applyModelOverride(model: Model<Api>, override: ModelOverride): Model<Api> {
	const result = { ...model };

	if (override.name !== undefined) result.name = override.name;
	if (override.reasoning !== undefined) result.reasoning = override.reasoning;
	if (override.input !== undefined) result.input = override.input as ('text' | 'image')[];
	if (override.contextWindow !== undefined) result.contextWindow = override.contextWindow;
	if (override.maxTokens !== undefined) result.maxTokens = override.maxTokens;

	// Merge cost (partial override)
	if (override.cost) {
		result.cost = {
			input: override.cost.input ?? model.cost.input,
			output: override.cost.output ?? model.cost.output,
			cacheRead: override.cost.cacheRead ?? model.cost.cacheRead,
			cacheWrite: override.cost.cacheWrite ?? model.cost.cacheWrite,
		};
	}

	// Merge headers
	if (override.headers) {
		const resolvedHeaders = resolveHeaders(override.headers);
		result.headers = resolvedHeaders ? { ...model.headers, ...resolvedHeaders } : model.headers;
	}

	// Deep merge compat
	result.compat = mergeCompat(model.compat, override.compat);

	return result;
}

/**
 * Model Registry - manages all models (built-in + custom)
 */
export class ModelRegistry {
	private models: Model<Api>[] = [];
	private customProviderApiKeys: Map<string, string> = new Map();
	private loadError: string | undefined = undefined;

	// Performance caches
	private _availableModelsCache: Model<Api>[] | undefined;
	private _providersCache: string[] | undefined;
	private _authStatusCache: Map<string, boolean> = new Map();

	constructor(private modelsJsonPath: string = getModelsJsonPath()) {
		this.loadModels();
	}

	/**
	 * Reload models from disk (built-in + custom from models.json)
	 * Clears all caches
	 */
	refresh(): void {
		this.customProviderApiKeys.clear();
		this.loadError = undefined;
		this._availableModelsCache = undefined;
		this._providersCache = undefined;
		this._authStatusCache.clear();
		this.loadModels();
		log.info('Model registry refreshed');
	}

	/**
	 * Get any error from loading models.json (undefined if no error)
	 */
	getError(): string | undefined {
		return this.loadError;
	}

	/**
	 * Get all models (built-in + custom)
	 * Results are cached until refresh() is called
	 */
	getAll(): readonly Model<Api>[] {
		return this.models;
	}

	/**
	 * Get only models that have auth configured
	 * Results are cached on first call until refresh()
	 */
	getAvailable(): readonly Model<Api>[] {
		// Lazy initialization with caching
		if (!this._availableModelsCache) {
			this._availableModelsCache = this.models.filter((m) => this.hasAuth(m.provider));
		}
		return this._availableModelsCache;
	}

	/**
	 * Find a model by provider and ID
	 */
	find(provider: string, modelId: string): Model<Api> | undefined {
		return this.models.find((m) => m.provider === provider && m.id === modelId);
	}

	/**
	 * Resolve a model reference (provider/modelId or just modelId)
	 */
	resolve(ref: string): Model<Api> | undefined {
		// Handle provider/modelId format
		if (ref.includes('/')) {
			const [provider, modelId] = ref.split('/');
			return this.find(provider, modelId);
		}

		// Try to find by model ID only (search all providers)
		for (const model of this.models) {
			if (model.id === ref) {
				return model;
			}
		}

		return undefined;
	}

	/**
	 * Get API key for a provider (for custom providers from models.json)
	 */
	getApiKey(provider: string): string | undefined {
		// First check custom provider configs
		const keyConfig = this.customProviderApiKeys.get(provider);
		if (keyConfig) {
			return resolveConfigValue(keyConfig);
		}
		return undefined;
	}

	/**
	 * Check if a provider has auth configured
	 * Results are cached until refresh() is called
	 */
	private hasAuth(provider: string): boolean {
		// Check cache first
		if (this._authStatusCache.has(provider)) {
			return this._authStatusCache.get(provider)!;
		}

		// Compute and cache
		let result: boolean;
		
		// Check custom provider configs from models.json first
		if (this.customProviderApiKeys.has(provider)) {
			const key = this.getApiKey(provider);
			result = !!key;
		} else {
			// Also check environment variables
			const envKey = getApiKeyFromEnv(provider);
			result = !!envKey;
		}

		this._authStatusCache.set(provider, result);
		return result;
	}

	/**
	 * Load all models
	 * Clears caches to ensure fresh data
	 */
	private loadModels(): void {
		// Clear caches before loading
		this._availableModelsCache = undefined;
		this._providersCache = undefined;
		this._authStatusCache.clear();

		// Load custom models and overrides from models.json
		const {
			models: customModels,
			overrides,
			modelOverrides,
			apiKeyConfigs,
			error,
		} = this.loadCustomModels();

		if (error) {
			this.loadError = error;
			log.warn({ error }, 'Failed to load models.json, using built-in models only');
		}

		// Store API key configs for fallback resolution
		this.customProviderApiKeys = apiKeyConfigs;

		// Load built-in models with overrides applied
		const builtInModels = this.loadBuiltInModels(overrides, modelOverrides);

		// Merge custom models
		this.models = this.mergeCustomModels(builtInModels, customModels);

		log.info(
			{ builtIn: builtInModels.length, custom: customModels.length, total: this.models.length },
			'Models loaded'
		);
	}

	/**
	 * Load built-in models and apply provider/model overrides
	 */
	private loadBuiltInModels(
		overrides: Map<string, ProviderOverride>,
		modelOverrides: Map<string, Map<string, ModelOverride>>,
	): Model<Api>[] {
		return getPiAiProviders().flatMap((provider) => {
			try {
				const models = getPiAiModels(provider as KnownProvider) as Model<Api>[];
				const providerOverride = overrides.get(provider);
				const perModelOverrides = modelOverrides.get(provider);

				return models.map((m) => {
					let model = m;

					// Apply provider-level baseUrl/headers override
					if (providerOverride) {
						const resolvedHeaders = resolveHeaders(providerOverride.headers);
						model = {
							...model,
							baseUrl: providerOverride.baseUrl ?? model.baseUrl,
							headers: resolvedHeaders ? { ...model.headers, ...resolvedHeaders } : model.headers,
						};
					}

					// Apply per-model override
					const modelOverride = perModelOverrides?.get(m.id);
					if (modelOverride) {
						model = applyModelOverride(model, modelOverride);
					}

					return model;
				});
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				log.error({ provider, error: errorMsg }, 'Failed to load built-in models for provider');
				return [];
			}
		});
	}

	/**
	 * Merge custom models into built-in list (custom wins on conflicts)
	 */
	private mergeCustomModels(builtInModels: Model<Api>[], customModels: Model<Api>[]): Model<Api>[] {
		const merged = [...builtInModels];
		for (const customModel of customModels) {
			const existingIndex = merged.findIndex(
				(m) => m.provider === customModel.provider && m.id === customModel.id
			);
			if (existingIndex >= 0) {
				merged[existingIndex] = customModel;
			} else {
				merged.push(customModel);
			}
		}
		return merged;
	}

	/**
	 * Load custom models from models.json
	 */
	private loadCustomModels(): CustomModelsResult {
		if (!existsSync(this.modelsJsonPath)) {
			return emptyCustomModelsResult();
		}

		try {
			const content = readFileSync(this.modelsJsonPath, 'utf-8');
			const config: ModelsJsonConfig = JSON.parse(content);

			// Validate schema
			const validation = validateModelsConfig(config);
			if (!validation.valid) {
				const errors = validation.errors
					.map((e) => `  - ${e.path}: ${e.message}`)
					.join('\n');
				return emptyCustomModelsResult(
					`Invalid models.json schema:\n${errors}\n\nFile: ${this.modelsJsonPath}`
				);
			}

			const overrides = new Map<string, ProviderOverride>();
			const modelOverrides = new Map<string, Map<string, ModelOverride>>();
			const apiKeyConfigs = new Map<string, string>();

			for (const [providerName, providerConfig] of Object.entries(config.providers)) {
				// Apply provider-level baseUrl/headers/apiKey override
				if (providerConfig.baseUrl || providerConfig.headers || providerConfig.apiKey) {
					overrides.set(providerName, {
						baseUrl: providerConfig.baseUrl,
						headers: providerConfig.headers,
						apiKey: providerConfig.apiKey,
					});
				}

				// Store API key config for fallback resolver
				if (providerConfig.apiKey) {
					apiKeyConfigs.set(providerName, providerConfig.apiKey);
				}

				// Store model overrides
				if (providerConfig.modelOverrides) {
					modelOverrides.set(providerName, new Map(Object.entries(providerConfig.modelOverrides)));
				}
			}

			return {
				models: this.parseModels(config),
				overrides,
				modelOverrides,
				apiKeyConfigs,
				error: undefined,
			};
		} catch (error) {
			if (error instanceof SyntaxError) {
				return emptyCustomModelsResult(
					`Failed to parse models.json: ${error.message}\n\nFile: ${this.modelsJsonPath}`
				);
			}
			return emptyCustomModelsResult(
				`Failed to load models.json: ${error instanceof Error ? error.message : error}\n\nFile: ${this.modelsJsonPath}`
			);
		}
	}

	/**
	 * Parse custom models from config
	 */
	private parseModels(config: ModelsJsonConfig): Model<Api>[] {
		const models: Model<Api>[] = [];
		const defaults = getDefaultModelValues();

		for (const [providerName, providerConfig] of Object.entries(config.providers)) {
			const modelDefs = providerConfig.models ?? [];
			if (modelDefs.length === 0) continue;

			for (const modelDef of modelDefs) {
				const api = modelDef.api || providerConfig.api;
				if (!api) continue;

				// Merge headers: provider headers are base, model headers override
				// Resolve env vars and shell commands in header values
				const providerHeaders = resolveHeaders(providerConfig.headers);
				const modelHeaders = resolveHeaders(modelDef.headers);
				let headers =
					providerHeaders || modelHeaders ? { ...providerHeaders, ...modelHeaders } : undefined;

				// If authHeader is true, add Authorization header with resolved API key
				if (providerConfig.authHeader && providerConfig.apiKey) {
					const resolvedKey = resolveConfigValue(providerConfig.apiKey);
					if (resolvedKey) {
						headers = { ...headers, Authorization: `Bearer ${resolvedKey}` };
					}
				}

				models.push({
					id: modelDef.id,
					name: modelDef.name ?? modelDef.id,
					api: api as Api,
					provider: providerName,
					baseUrl: providerConfig.baseUrl!,
					reasoning: modelDef.reasoning ?? false,
					input: (modelDef.input ?? defaults.input) as ('text' | 'image')[],
					cost: modelDef.cost ?? defaults.cost,
					contextWindow: modelDef.contextWindow ?? defaults.contextWindow,
					maxTokens: modelDef.maxTokens ?? defaults.maxTokens,
					headers,
					compat: modelDef.compat as Model<Api>['compat'],
				} as Model<Api>);
			}
		}

		return models;
	}
}

// ============================================
// Global Registry Instance
// ============================================

let globalRegistry: ModelRegistry | undefined;

export function getModelRegistry(): ModelRegistry {
	if (!globalRegistry) {
		globalRegistry = new ModelRegistry();
	}
	return globalRegistry;
}

export function resetModelRegistry(): void {
	globalRegistry = undefined;
}