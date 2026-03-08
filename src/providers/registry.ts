/**
 * Model Registry
 * 
 * Model registration and management based on pi-mono architecture.
 * Loads built-in models from @mariozechner/pi-ai and custom models from config.json.
 * Supports auto-discovery of local Ollama models.
 * Supports AuthProfiles for OAuth and API key authentication.
 */

import {
	type Api,
	type Model,
	type KnownProvider,
	type OAuthCredentials,
} from '@mariozechner/pi-ai';
import { getApiKey as getConfigApiKey } from '../config/schema.js';
import type { Config } from '../config/schema.js';
import { listProfilesForProvider } from '../auth/profiles/profiles.js';
import { resolveApiKeyForProfile } from '../auth/profiles/oauth.js';
import { createProviderConfig } from './config.js';

// Import new config integration
import { getEffectiveConfig } from '../config/integration.js';

// Import from provider-catalog
import {
	getProvider as getProviderFromCatalog,
	getProviderApiKey as getProviderApiKeyFromCatalog,
	isProviderConfigured,
	getConfiguredProviders,
	getProviderDisplayInfo,
	detectProviderByModel,
	getAllProviders,
} from './provider-catalog.js';

// Import new unified model loader
import { buildRegistry, getAllModels } from './models-loader.js';

// Import from model-catalog
import {
	modelSupportsFeature,
	modelSupportsModality,
} from './model-catalog.js';

const providerConfig = createProviderConfig();
const OLLAMA_API_BASE = providerConfig.ollamaBaseUrl;
const OLLAMA_TAGS_URL = `${OLLAMA_API_BASE}/api/tags`;
const OLLAMA_TIMEOUT_MS = providerConfig.ollamaTimeoutMs;
const OLLAMA_DISCOVERY_TIMEOUT_MS = providerConfig.ollamaDiscoveryTimeoutMs;

interface OllamaModel {
	name: string;
	model: string;
	modified_at: string;
	size: number;
	digest: string;
	details?: {
		parameter_size?: string;
		quantization_level?: string;
		family?: string;
	};
}

interface OllamaTagsResponse {
	models: OllamaModel[];
}

async function discoverOllamaModels(): Promise<Model<Api>[]> {
	try {
		const response = await fetch(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS) });
		if (!response.ok) return [];

		const data = (await response.json()) as OllamaTagsResponse;
		if (!data.models || data.models.length === 0) return [];

		return data.models.map((model: OllamaModel) => ({
			id: model.name,
			name: model.name,
			api: 'openai-completions' as Api,
			provider: 'ollama',
			baseUrl: `${OLLAMA_API_BASE}/v1`,
			reasoning: model.name.toLowerCase().includes('r1') || model.name.toLowerCase().includes('reasoning'),
			input: ['text'] as ('text' | 'image')[],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 131072,
			maxTokens: 4096,
			params: { streaming: false },
			headers: process.env.OLLAMA_API_KEY ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : undefined,
		})) as Model<Api>[];
	} catch {
		return [];
	}
}

async function isOllamaRunning(): Promise<boolean> {
	try {
		const response = await fetch(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(OLLAMA_DISCOVERY_TIMEOUT_MS) });
		return response.ok;
	} catch {
		return false;
	}
}

export interface ProviderOverride {
	baseUrl?: string;
	apiKey?: string;
	api?: 'openai-completions' | 'anthropic-messages' | 'google-generative-ai';
	models?: string[] | ModelMetadata[];
}

/** Model metadata for detailed model configuration */
export interface ModelMetadata {
	id: string;
	name: string;
	reasoning?: boolean;
	input?: ('text' | 'image')[];
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	contextWindow?: number;
	maxTokens?: number;
}

/** Provider information for UI display */
export interface ProviderInfo {
	id: string;
	name: string;
	envKey: string;
	authType: 'api_key' | 'oauth' | 'token';
	supportsOAuth: boolean;
	baseUrl?: string;
	logo?: string;
}

/**
 * Provider information map for UI display.
 * Use getProviderDisplayInfo from provider-catalog for new code.
 */
export const PROVIDER_INFO: Record<string, ProviderInfo> = {
	'openai': { id: 'openai', name: 'OpenAI', envKey: 'OPENAI_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.openai.com/v1' },
	'anthropic': { id: 'anthropic', name: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', authType: 'api_key', supportsOAuth: true, baseUrl: 'https://api.anthropic.com' },
	'google': { id: 'google', name: 'Google', envKey: 'GOOGLE_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://generativelanguage.googleapis.com/v1' },
	'google-gemini-cli': { id: 'google-gemini-cli', name: 'Google Gemini CLI', envKey: 'GOOGLE_GEMINI_CLI_API_KEY', authType: 'oauth', supportsOAuth: true },
	'google-antigravity': { id: 'google-antigravity', name: 'Google Antigravity', envKey: '', authType: 'oauth', supportsOAuth: true },
	'github-copilot': { id: 'github-copilot', name: 'GitHub Copilot', envKey: 'GITHUB_COPILOT_TOKEN', authType: 'token', supportsOAuth: true },
	'openai-codex': { id: 'openai-codex', name: 'OpenAI Codex', envKey: 'OPENAI_CODEX_API_KEY', authType: 'api_key', supportsOAuth: true },
	'qwen': { id: 'qwen', name: 'Qwen', envKey: 'QWEN_API_KEY', authType: 'api_key', supportsOAuth: true, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
	'bailian': { id: 'bailian', name: 'Bailian', envKey: 'BAILIAN_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://coding.dashscope.aliyuncs.com/v1' },
	'kimi': { id: 'kimi', name: 'Kimi', envKey: 'KIMI_API_KEY', authType: 'api_key', supportsOAuth: true, baseUrl: 'https://api.moonshot.cn/v1' },
	'moonshot': { id: 'moonshot', name: 'Moonshot AI', envKey: 'MOONSHOT_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.moonshot.ai/v1' },
	'minimax': { id: 'minimax', name: 'MiniMax', envKey: 'MINIMAX_API_KEY', authType: 'api_key', supportsOAuth: true, baseUrl: 'https://api.minimax.io/v1' },
	'minimax-cn': { id: 'minimax-cn', name: 'MiniMax CN', envKey: 'MINIMAX_CN_API_KEY', authType: 'api_key', supportsOAuth: true, baseUrl: 'https://api.minimaxi.com/v1' },
	'zhipu': { id: 'zhipu', name: 'Zhipu (GLM)', envKey: 'ZHIPU_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
	'zhipu-cn': { id: 'zhipu-cn', name: 'Zhipu CN', envKey: 'ZHIPU_CN_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
	'deepseek': { id: 'deepseek', name: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.deepseek.com/v1' },
	'groq': { id: 'groq', name: 'Groq', envKey: 'GROQ_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.groq.com/openai/v1' },
	'openrouter': { id: 'openrouter', name: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://openrouter.ai/api/v1' },
	'xai': { id: 'xai', name: 'xAI (Grok)', envKey: 'XAI_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.x.ai/v1' },
	'cerebras': { id: 'cerebras', name: 'Cerebras', envKey: 'CEREBRAS_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.cerebras.ai/v1' },
	'mistral': { id: 'mistral', name: 'Mistral AI', envKey: 'MISTRAL_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.mistral.ai/v1' },
	'ollama': { id: 'ollama', name: 'Ollama (Local)', envKey: 'OLLAMA_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'http://127.0.0.1:11434/v1' },
	'azure-openai': { id: 'azure-openai', name: 'Azure OpenAI', envKey: 'AZURE_OPENAI_API_KEY', authType: 'api_key', supportsOAuth: false },
	'amazon-bedrock': { id: 'amazon-bedrock', name: 'Amazon Bedrock', envKey: '', authType: 'api_key', supportsOAuth: false },
	'google-vertex': { id: 'google-vertex', name: 'Google Vertex AI', envKey: '', authType: 'oauth', supportsOAuth: true },
	'huggingface': { id: 'huggingface', name: 'Hugging Face', envKey: 'HF_TOKEN', authType: 'token', supportsOAuth: false, baseUrl: 'https://api-inference.huggingface.co' },
	'vercel-ai-gateway': { id: 'vercel-ai-gateway', name: 'Vercel AI Gateway', envKey: '', authType: 'api_key', supportsOAuth: false },
	'zai': { id: 'zai', name: 'ZAI', envKey: 'ZAI_API_KEY', authType: 'api_key', supportsOAuth: false },
	'opencode': { id: 'opencode', name: 'OpenCode', envKey: 'OPENCODE_API_KEY', authType: 'api_key', supportsOAuth: false },
};

/** OAuth provider refresh functions */
const oauthRefreshFunctions: Map<string, (credentials: OAuthCredentials) => Promise<OAuthCredentials>> = new Map();

/** Register OAuth refresh function for a provider */
export function registerOAuthRefresh(provider: string, fn: (credentials: OAuthCredentials) => Promise<OAuthCredentials>): void {
	oauthRefreshFunctions.set(provider, fn);
}

export class ModelRegistry {
	private models: Model<Api>[] = [];
	private config: Config | null = null;
	private _error: string | undefined;
	private ollamaEnabled: boolean = true;
	private ollamaDiscovery: boolean = true;
	private ollamaModels: Model<Api>[] = [];
	private useAuthProfiles: boolean = true;

	constructor(
		config?: Config | null,
		options?: { ollamaEnabled?: boolean; ollamaDiscovery?: boolean; useAuthProfiles?: boolean }
	) {
		this.config = config ?? null;
		this.ollamaEnabled = options?.ollamaEnabled ?? true;
		this.ollamaDiscovery = options?.ollamaDiscovery ?? true;
		this.useAuthProfiles = options?.useAuthProfiles ?? true;
		this.loadModels();
	}

	/**
	 * Enable/disable auth profiles (default: true)
	 */
	setUseAuthProfiles(enabled: boolean): void {
		this.useAuthProfiles = enabled;
	}

	/**
	 * Get API key for a provider (supports OAuth and AuthProfiles).
	 */
	async getApiKey(provider: string): Promise<string | undefined> {
		// Try AuthProfiles first
		if (this.useAuthProfiles) {
			const profiles = listProfilesForProvider(provider);
			if (profiles.length > 0) {
				// Try first profile with valid auth
				for (const profile of profiles) {
					if (profile.hasKey) {
						const key = await resolveApiKeyForProfile(
							profile.profileId,
							oauthRefreshFunctions.get(provider)
						);
						if (key) return key;
					}
				}
			}
		}

		// Try provider-catalog
		const catalogKey = getProviderApiKeyFromCatalog(provider);
		if (catalogKey) return catalogKey;

		// Fall back to config
		if (this.config) {
			return getConfigApiKey(this.config, provider) ?? undefined;
		}

		return undefined;
	}

	/**
	 * Get provider definition from catalog
	 */
	getProviderFromCatalog(providerId: string) {
		return getProviderFromCatalog(providerId);
	}

	/**
	 * Check if provider is configured using catalog
	 */
	isProviderConfigured(providerId: string): boolean {
		return isProviderConfigured(providerId);
	}

	/**
	 * Get all configured providers using catalog
	 */
	getConfiguredProviders() {
		return getConfiguredProviders();
	}

	/**
	 * Auto-detect provider by model ID
	 */
	detectProvider(modelId: string): string | undefined {
		return detectProviderByModel(modelId);
	}

	/**
	 * Check if model supports a specific feature
	 */
	modelSupportsFeature(modelId: string, feature: string): boolean {
		// Parse provider/model format
		const { model } = this.parseModelRef(modelId);
		return modelSupportsFeature(model, feature as any);
	}

	/**
	 * Check if model supports a specific modality
	 */
	modelSupportsModality(modelId: string, modality: string): boolean {
		const { model } = this.parseModelRef(modelId);
		return modelSupportsModality(model, modality as any);
	}

	/**
	 * Parse model reference
	 */
	parseModelRef(ref: string): { provider: string; model: string } {
		const slashIndex = ref.indexOf('/');
		if (slashIndex === -1) {
			// Try to detect provider
			const detected = detectProviderByModel(ref);
			return { provider: detected || 'openai', model: ref };
		}
		const provider = ref.substring(0, slashIndex);
		const model = ref.substring(slashIndex + 1);
		return { provider, model };
	}

	private loadModels(): void {
		this.loadBuiltInModels();

		if (this.config) {
			this.applyModelsConfig();
		}

		// Auto-discover Ollama models (async)
		if (this.ollamaEnabled && this.ollamaDiscovery) {
			this.discoverLocalModels();
		}
	}

	private loadBuiltInModels(): void {
		// Use new unified loader for built-in models
		try {
			const resolvedModels = getAllModels(this.config);
			
			// Convert ResolvedModel to pi-ai Model<Api> format for backward compatibility
			for (const model of resolvedModels) {
				this.models.push({
					id: model.id,
					name: model.name,
					api: model.api as Api,
					provider: model.provider as KnownProvider,
					baseUrl: model.baseUrl,
					reasoning: model.reasoning,
					input: model.input as ("text" | "image")[],
					cost: {
						input: model.cost.input,
						output: model.cost.output,
						cacheRead: 0,
						cacheWrite: 0,
					},
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					headers: model.headers,
				});
			}
		} catch (error) {
			console.warn('Failed to load built-in models:', error);
		}
	}

	private async discoverLocalModels(): Promise<void> {
		try {
			this.ollamaModels = await discoverOllamaModels();
			if (this.ollamaModels.length > 0) {
				const existingIds = new Set(this.models.filter((m) => m.provider === 'ollama').map((m) => m.id));
				const newModels = this.ollamaModels.filter((m) => !existingIds.has(m.id));
				this.models.push(...newModels);
			}
		} catch {
			// Ignore discovery errors
		}
	}

	/**
	 * Apply xopcbot models config (new format)
	 */
	private applyModelsConfig(): void {
		if (!this.config) return;

		// Get effective models config (with defaults applied)
		const effectiveConfig = getEffectiveConfig(this.config);
		const modelsConfig = effectiveConfig.models;

		if (!modelsConfig?.providers) return;

		for (const [providerId, providerConfig] of Object.entries(modelsConfig.providers)) {
			// Skip if no models
			if (!providerConfig.models || providerConfig.models.length === 0) continue;

			for (const modelDef of providerConfig.models) {
				// Check if model already exists
				const existingIndex = this.models.findIndex(
					(m) => m.provider === providerId && m.id === modelDef.id
				);

				const modelEntry: Model<Api> = {
					id: modelDef.id,
					name: modelDef.name,
					api: (modelDef.api ?? providerConfig.api ?? 'openai-completions') as Api,
					provider: providerId,
					baseUrl: providerConfig.baseUrl,
					reasoning: modelDef.reasoning ?? false,
					input: modelDef.input ?? ['text'],
					cost: {
						input: modelDef.cost?.input ?? 0,
						output: modelDef.cost?.output ?? 0,
						cacheRead: modelDef.cost?.cacheRead ?? 0,
						cacheWrite: modelDef.cost?.cacheWrite ?? 0,
					},
					contextWindow: modelDef.contextWindow ?? 128000,
					maxTokens: modelDef.maxTokens ?? 16384,
					headers: providerConfig.headers ?? modelDef.headers,
				};

				if (existingIndex >= 0) {
					this.models[existingIndex] = modelEntry;
				} else {
					this.models.push(modelEntry);
				}
			}
		}
	}

	updateConfig(config: Config): void {
		this.config = config;
		this.models = [];
		this._error = undefined;
		this.loadModels();
	}

	async refreshAsync(): Promise<void> {
		this.models = [];
		this._error = undefined;
		this.loadBuiltInModels();
		// Load from new models config only
		if (this.config) {
			this.applyModelsConfig();
		}
		if (this.ollamaEnabled && this.ollamaDiscovery) {
			await this.discoverLocalModels();
		}
	}

	/** Get all models (built-in + custom + Ollama) */
	getAll(): Model<Api>[] {
		return this.models;
	}

	/** Get models grouped by provider */
	getByProvider(): Map<string, Model<Api>[]> {
		const byProvider = new Map<string, Model<Api>[]>();
		for (const model of this.models) {
			const list = byProvider.get(model.provider) ?? [];
			list.push(model);
			byProvider.set(model.provider, list);
		}
		return byProvider;
	}

	/** Get only models that have auth configured (sync - uses config only) */
	getAvailableSync(): Model<Api>[] {
		if (!this.config) return this.models;

		return this.models.filter((m) => {
			const apiKey = getConfigApiKey(this.config!, m.provider);
			return !!apiKey || m.provider === 'ollama';
		});
	}

	/** Get only models that have auth configured (async - supports OAuth and AuthProfiles) */
	async getAvailable(): Promise<Model<Api>[]> {
		if (!this.config && !this.useAuthProfiles) return this.models;

		const available: Model<Api>[] = [];
		
		for (const m of this.models) {
			// Ollama is always available (local)
			if (m.provider === 'ollama') {
				available.push(m);
				continue;
			}

			// Check auth via AuthProfiles
			if (this.useAuthProfiles) {
				const profiles = listProfilesForProvider(m.provider);
				if (profiles.some(p => p.hasKey)) {
					available.push(m);
					continue;
				}
			}

			// Check via provider-catalog
			if (isProviderConfigured(m.provider)) {
				available.push(m);
				continue;
			}

			// Fall back to config
			if (this.config) {
				const apiKey = getConfigApiKey(this.config, m.provider);
				if (apiKey) {
					available.push(m);
				}
			}
		}

		return available;
	}

	find(provider: string, modelId: string): Model<Api> | undefined {
		return this.models.find(
			(m) =>
				m.provider.toLowerCase() === provider.toLowerCase() &&
				m.id.toLowerCase() === modelId.toLowerCase()
		);
	}

	findByRef(ref: string): Model<Api> | undefined {
		const slashIndex = ref.indexOf('/');
		if (slashIndex === -1) {
			return this.models.find((m) => m.id.toLowerCase() === ref.toLowerCase());
		}
		const provider = ref.substring(0, slashIndex);
		const modelId = ref.substring(slashIndex + 1);
		return this.find(provider, modelId);
	}

	getError(): string | undefined {
		return this._error;
	}

	refresh(): void {
		this.models = [];
		this._error = undefined;
		this.loadModels();
	}

	async isOllamaAvailable(): Promise<boolean> {
		return isOllamaRunning();
	}

	async getOllamaModels(): Promise<Model<Api>[]> {
		return discoverOllamaModels();
	}

	/** Check if model has auth configured (sync) */
	hasAuth(provider: string): boolean {
		// Check AuthProfiles first
		if (this.useAuthProfiles) {
			const profiles = listProfilesForProvider(provider);
			if (profiles.some(p => p.hasKey)) {
				return true;
			}
		}
		// Check provider-catalog
		if (isProviderConfigured(provider)) {
			return true;
		}
		// Fall back to config
		if (!this.config) return false;
		return !!getConfigApiKey(this.config, provider);
	}

	/** Check if model has auth configured (async - supports OAuth and AuthProfiles) */
	async hasAuthAsync(provider: string): Promise<boolean> {
		// Check AuthProfiles first
		if (this.useAuthProfiles) {
			const profiles = listProfilesForProvider(provider);
			for (const profile of profiles) {
				if (profile.hasKey) {
					if (profile.expires && Date.now() >= profile.expires) {
						continue; // Token expired
					}
					return true;
				}
			}
		}
		// Check provider-catalog
		if (isProviderConfigured(provider)) {
			return true;
		}
		// Fall back to config
		if (!this.config) return false;
		return !!getConfigApiKey(this.config, provider);
	}

	/** 
	 * Get provider info 
	 */
	static getProviderInfo(provider: string): ProviderInfo | undefined {
		const fromCatalog = getProviderDisplayInfo(provider);
		if (fromCatalog) {
			const authType = fromCatalog.authType === 'none' ? 'api_key' : fromCatalog.authType;
			return {
				id: fromCatalog.id,
				name: fromCatalog.name,
				envKey: fromCatalog.envKeys[0] || '',
				authType,
				supportsOAuth: fromCatalog.supportsOAuth,
				baseUrl: fromCatalog.baseUrl,
				logo: fromCatalog.logo,
			};
		}
		return PROVIDER_INFO[provider];
	}

	/** 
	 * Get all provider infos 
	 */
	static getAllProviderInfo(): ProviderInfo[] {
		const fromCatalog = getAllProviders().map(p => getProviderDisplayInfo(p.id));
		if (fromCatalog.length > 0 && fromCatalog[0]) {
			return fromCatalog.map(info => {
				const authType = info.authType === 'none' ? 'api_key' : info.authType;
				return {
					id: info.id,
					name: info.name,
					envKey: info.envKeys[0] || '',
					authType,
					supportsOAuth: info.supportsOAuth,
					baseUrl: info.baseUrl,
					logo: info.logo,
				};
			});
		}
		return Object.values(PROVIDER_INFO);
	}
}

export function resolveConfigValue(value: string): string {
	const match = /^\$\{([A-Z0-9_]+)\}$/.exec(value);
	return match ? process.env[match[1]] ?? value : value;
}
