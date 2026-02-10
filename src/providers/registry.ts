/**
 * Model Registry
 * 
 * Model registration and management based on pi-mono architecture.
 * Loads built-in models from @mariozechner/pi-ai and custom models from config.json.
 * Supports auto-discovery of local Ollama models.
 */

import {
	getModels,
	getProviders,
	type Api,
	type Model,
	type KnownProvider,
} from '@mariozechner/pi-ai';
import { getApiKey as getConfigApiKey, getApiBase } from '../config/schema.js';
import type { Config } from '../config/schema.js';

// ============================================
// Ollama Auto-Discovery
// ============================================

const OLLAMA_API_BASE = 'http://127.0.0.1:11434';
const OLLAMA_TAGS_URL = `${OLLAMA_API_BASE}/api/tags`;

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

/**
 * Discover locally running Ollama models
 */
async function discoverOllamaModels(): Promise<Model<Api>[]> {
	try {
		const response = await fetch(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(5000) });
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

/**
 * Check if Ollama is running locally
 */
async function isOllamaRunning(): Promise<boolean> {
	try {
		const response = await fetch(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(2000) });
		return response.ok;
	} catch {
		return false;
	}
}

// ============================================
// Model Registry
// ============================================

export interface ProviderOverride {
	baseUrl?: string;
	apiKey?: string;
	api?: 'openai-completions' | 'anthropic-messages' | 'google-generative-ai';
	models?: string[];
}

export class ModelRegistry {
	private models: Model<Api>[] = [];
	private config: Config | null = null;
	private _error: string | undefined;
	private ollamaEnabled: boolean = true;
	private ollamaDiscovery: boolean = true;
	private ollamaModels: Model<Api>[] = [];

	constructor(config?: Config | null, options?: { ollamaEnabled?: boolean; ollamaDiscovery?: boolean }) {
		this.config = config ?? null;
		this.ollamaEnabled = options?.ollamaEnabled ?? true;
		this.ollamaDiscovery = options?.ollamaDiscovery ?? true;
		this.loadModels();
	}

	private loadModels(): void {
		// 1. Load built-in models from pi-ai
		this.loadBuiltInModels();

		// 2. Apply provider overrides from config
		if (this.config) {
			this.applyProviderOverrides();
		}

		// 3. Auto-discover Ollama models (async)
		if (this.ollamaEnabled && this.ollamaDiscovery) {
			this.discoverLocalModels();
		}
	}

	private loadBuiltInModels(): void {
		try {
			const providers = getProviders() as string[];
			for (const provider of providers) {
				const builtInModels = getModels(provider as KnownProvider) as Model<Api>[];
				this.models.push(...builtInModels);
			}
		} catch (error) {
			console.warn('Failed to load built-in models:', error);
		}
	}

	private applyProviderOverrides(): void {
		if (!this.config) return;

		const providers = this.config.providers as Record<string, ProviderOverride>;

		for (const [providerName, providerConfig] of Object.entries(providers)) {
			// Override baseUrl if specified
			if (providerConfig.baseUrl) {
				this.models = this.models.map((m) => {
					if (m.provider === providerName) {
						return { ...m, baseUrl: providerConfig.baseUrl! };
					}
					return m;
				});
			}

			// Add custom models if specified
			if (providerConfig.models && providerConfig.models.length > 0) {
				const api = (providerConfig.api ?? 'openai-completions') as Api;
				const baseUrl = providerConfig.baseUrl ?? getApiBase(this.config, providerName) ?? '';

				for (const modelId of providerConfig.models) {
					// Check if model already exists
					const exists = this.models.some((m) => m.provider === providerName && m.id === modelId);
					if (!exists) {
						this.models.push({
							id: modelId,
							name: modelId,
							api,
							provider: providerName,
							baseUrl,
							reasoning: false,
							input: ['text'],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 128000,
							maxTokens: 16384,
						} as Model<Api>);
					}
				}
			}
		}
	}

	private async discoverLocalModels(): Promise<void> {
		try {
			this.ollamaModels = await discoverOllamaModels();
			if (this.ollamaModels.length > 0) {
				// Filter out duplicates (if already defined)
				const existingIds = new Set(this.models.filter((m) => m.provider === 'ollama').map((m) => m.id));
				const newModels = this.ollamaModels.filter((m) => !existingIds.has(m.id));
				this.models.push(...newModels);
			}
		} catch {
			// Ignore discovery errors
		}
	}

	/** Update config and reload */
	updateConfig(config: Config): void {
		this.config = config;
		this.models = [];
		this._error = undefined;
		this.loadModels();
	}

	/** Async refresh that includes discovery */
	async refreshAsync(): Promise<void> {
		this.models = [];
		this._error = undefined;
		this.loadBuiltInModels();
		if (this.config) {
			this.applyProviderOverrides();
		}
		if (this.ollamaEnabled && this.ollamaDiscovery) {
			await this.discoverLocalModels();
		}
	}

	/** Get all models (built-in + custom + Ollama) */
	getAll(): Model<Api>[] {
		return this.models;
	}

	/** Get only models that have auth configured */
	getAvailable(): Model<Api>[] {
		if (!this.config) return this.models;

		return this.models.filter((m) => {
			const apiKey = getConfigApiKey(this.config!, m.provider);
			return !!apiKey || m.provider === 'ollama';
		});
	}

	/** Find a model by provider and ID */
	find(provider: string, modelId: string): Model<Api> | undefined {
		return this.models.find(
			(m) =>
				m.provider.toLowerCase() === provider.toLowerCase() &&
				m.id.toLowerCase() === modelId.toLowerCase()
		);
	}

	/** Find a model by ref (provider/modelId format) */
	findByRef(ref: string): Model<Api> | undefined {
		const slashIndex = ref.indexOf('/');
		if (slashIndex === -1) {
			return this.models.find((m) => m.id.toLowerCase() === ref.toLowerCase());
		}
		const provider = ref.substring(0, slashIndex);
		const modelId = ref.substring(slashIndex + 1);
		return this.find(provider, modelId);
	}

	/** Get any error */
	getError(): string | undefined {
		return this._error;
	}

	/** Refresh models from current config */
	refresh(): void {
		this.models = [];
		this._error = undefined;
		this.loadModels();
	}

	/** Check if Ollama is available */
	async isOllamaAvailable(): Promise<boolean> {
		return isOllamaRunning();
	}

	/** Get Ollama models (fresh discovery) */
	async getOllamaModels(): Promise<Model<Api>[]> {
		return discoverOllamaModels();
	}

	/** Check if model has auth configured */
	hasAuth(provider: string): boolean {
		if (!this.config) return false;
		return !!getConfigApiKey(this.config, provider);
	}
}

// ============================================
// Utility Functions
// ============================================

/** Resolve environment variable in config value (${VAR_NAME} syntax) */
export function resolveConfigValue(value: string): string {
	const match = /^\$\{([A-Z0-9_]+)\}$/.exec(value);
	return match ? process.env[match[1]] ?? value : value;
}
