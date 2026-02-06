/**
 * Model Registry
 * 
 * Model registration and management based on pi-mono architecture.
 * Loads built-in models from @mariozechner/pi-ai and custom models from models.json.
 * Supports auto-discovery of local Ollama models.
 */

import {
	getModels,
	getProviders,
	type Api,
	type Model,
	type KnownProvider,
} from '@mariozechner/pi-ai';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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
			contextWindow: 131072, // Default for most models
			maxTokens: 4096,
			params: { streaming: false }, // Ollama has streaming issues with some models
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

// JSON Schema for validation
const ModelDefinitionSchema = {
	type: 'object' as const,
	properties: {
		id: { type: 'string' as const },
		name: { type: 'string' as const },
		reasoning: { type: 'boolean' as const },
		input: {
			type: 'array' as const,
			items: { type: 'string' as const, enum: ['text', 'image'] },
		},
		cost: {
			type: 'object' as const,
			properties: {
				input: { type: 'number' as const },
				output: { type: 'number' as const },
				cacheRead: { type: 'number' as const },
				cacheWrite: { type: 'number' as const },
			},
			required: ['input', 'output', 'cacheRead', 'cacheWrite'],
		},
		contextWindow: { type: 'number' as const },
		maxTokens: { type: 'number' as const },
		headers: { type: 'object' as const, additionalProperties: { type: 'string' as const } },
		compat: { type: 'object' as const },
	},
	required: ['id'],
};

const ProviderConfigSchema = {
	type: 'object' as const,
	properties: {
		baseUrl: { type: 'string' as const },
		apiKey: { type: 'string' as const },
		api: { type: 'string' as const, enum: ['openai-completions', 'anthropic-messages', 'google-generative-ai'] },
		headers: { type: 'object' as const, additionalProperties: { type: 'string' as const } },
		authHeader: { type: 'boolean' as const },
		models: { type: 'array' as const, items: ModelDefinitionSchema },
	},
	required: ['baseUrl'],
};

const ModelsConfigSchema = {
	type: 'object' as const,
	properties: {
		providers: {
			type: 'object' as const,
			additionalProperties: ProviderConfigSchema,
		},
	},
	required: ['providers'],
};

export interface ModelConfig {
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: ('text' | 'image')[];
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow?: number;
	maxTokens?: number;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
}

export interface ProviderConfig {
	baseUrl: string;
	apiKey?: string;
	api?: 'openai-completions' | 'anthropic-messages' | 'google-generative-ai';
	headers?: Record<string, string>;
	authHeader?: boolean;
	models?: ModelConfig[];
}

export interface ModelsConfig {
	providers: Record<string, ProviderConfig>;
}

export class ModelRegistry {
	private models: Model<Api>[] = [];
	private configPath: string;
	private _error: string | undefined;
	private enableDiscovery: boolean;

	constructor(configPath?: string, enableDiscovery: boolean = true) {
		// Default to models.json in the same directory as the package
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = dirname(__filename);
		this.configPath = configPath ?? join(__dirname, '..', '..', 'models.json');
		this.enableDiscovery = enableDiscovery;
		this.loadModels();
	}

	private loadModels(): void {
		// 1. Load built-in models from pi-ai
		this.loadBuiltInModels();

		// 2. Load custom models from models.json
		if (existsSync(this.configPath)) {
			this.loadCustomModels();
		}

		// 3. Auto-discover Ollama models (async, will update later)
		if (this.enableDiscovery) {
			this.discoverLocalModels();
		}
	}

	/** Discover local models (Ollama, etc.) */
	private async discoverLocalModels(): Promise<void> {
		try {
			const ollamaModels = await discoverOllamaModels();
			if (ollamaModels.length > 0) {
				// Filter out duplicates (if already defined in models.json)
				const existingIds = new Set(this.models.filter(m => m.provider === 'ollama').map(m => m.id));
				const newModels = ollamaModels.filter(m => !existingIds.has(m.id));
				this.models.push(...newModels);
			}
		} catch {
			// Ignore discovery errors
		}
	}

	/** Async refresh that includes discovery */
	async refreshAsync(): Promise<void> {
		this.models = [];
		this._error = undefined;
		this.loadBuiltInModels();
		if (existsSync(this.configPath)) {
			this.loadCustomModels();
		}
		if (this.enableDiscovery) {
			await this.discoverLocalModels();
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

	private loadCustomModels(): void {
		try {
			const content = readFileSync(this.configPath, 'utf-8');
			const config: ModelsConfig = JSON.parse(content);

			// Validate schema
			if (!this.validateConfig(config)) {
				return;
			}

			// Parse custom models
			for (const [providerName, providerConfig] of Object.entries(config.providers)) {
				if (!providerConfig.models || providerConfig.models.length === 0) {
					// Override-only config: update baseUrl/headers for existing models
					this.applyProviderOverride(providerName, providerConfig);
					continue;
				}

				for (const modelDef of providerConfig.models) {
					const api = (providerConfig.api ?? 'openai-completions') as Api;

					// Merge headers
					let headers = providerConfig.headers;
					if (modelDef.headers) {
						headers = { ...headers, ...modelDef.headers };
					}

					// If authHeader is true, add Authorization header
					if (providerConfig.authHeader && providerConfig.apiKey) {
						headers = { ...headers, Authorization: `Bearer ${providerConfig.apiKey}` };
					}

					this.models.push({
						id: modelDef.id,
						name: modelDef.name ?? modelDef.id,
						api,
						provider: providerName,
						baseUrl: providerConfig.baseUrl,
						reasoning: modelDef.reasoning ?? false,
						input: (modelDef.input ?? ['text']) as ('text' | 'image')[],
						cost: modelDef.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: modelDef.contextWindow ?? 128000,
						maxTokens: modelDef.maxTokens ?? 16384,
						headers,
						compat: modelDef.compat as Model<Api>['compat'],
					} as Model<Api>);
				}
			}
		} catch (error) {
			if (error instanceof SyntaxError) {
				this._error = `Failed to parse models.json: ${error.message}`;
			} else {
				this._error = `Failed to load models.json: ${error instanceof Error ? error.message : error}`;
			}
			console.warn(this._error);
		}
	}

	private applyProviderOverride(providerName: string, config: ProviderConfig): void {
		const resolvedHeaders = config.headers;
		this.models = this.models.map((m) => {
			if (m.provider !== providerName) return m;
			return {
				...m,
				baseUrl: config.baseUrl ?? m.baseUrl,
				headers: resolvedHeaders ? { ...m.headers, ...resolvedHeaders } : m.headers,
			};
		});
	}

	private validateConfig(config: unknown): boolean {
		if (!config || typeof config !== 'object') {
			this._error = 'Invalid models.json: not an object';
			return false;
		}

		const providers = (config as Record<string, unknown>).providers;
		if (!providers || typeof providers !== 'object') {
			this._error = 'Invalid models.json: missing or invalid "providers" field';
			return false;
		}

		return true;
	}

	/** Get all models (built-in + custom) */
	getAll(): Model<Api>[] {
		return this.models;
	}

	/** Get only models that have auth configured (stub - actual check in AuthStorage) */
	getAvailable(): Model<Api>[] {
		return this.models;
	}

	/** Find a model by provider and ID */
	find(provider: string, modelId: string): Model<Api> | undefined {
		return this.models.find((m) => m.provider === provider && m.id === modelId);
	}

	/** Find a model by ref (provider/modelId format) */
	findByRef(ref: string): Model<Api> | undefined {
		const slashIndex = ref.indexOf('/');
		if (slashIndex === -1) {
			// Try to find by ID only
			return this.models.find((m) => m.id.toLowerCase() === ref.toLowerCase());
		}
		const provider = ref.substring(0, slashIndex);
		const modelId = ref.substring(slashIndex + 1);
		return this.find(provider, modelId);
	}

	/** Get any error from loading models.json */
	getError(): string | undefined {
		return this._error;
	}

	/** Refresh models from disk */
	refresh(): void {
		this.models = [];
		this._error = undefined;
		this.loadModels();
	}

	/** Check if Ollama is available */
	async isOllamaAvailable(): Promise<boolean> {
		return isOllamaRunning();
	}

	/** Get Ollama models (triggers fresh discovery) */
	async getOllamaModels(): Promise<Model<Api>[]> {
		return discoverOllamaModels();
	}
}

// ============================================
// Utility Functions
// ============================================

/** Get API key from environment variable or auth file */
export function getApiKey(provider: string, authFilePath?: string): string | undefined {
	// 1. Check environment variable
	const envKey = `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
	if (process.env[envKey]) {
		return process.env[envKey];
	}

	// 2. Check auth file
	if (authFilePath && existsSync(authFilePath)) {
		try {
			const content = readFileSync(authFilePath, 'utf-8');
			const authData = JSON.parse(content);
			return authData[provider]?.apiKey ?? authData[provider]?.key;
		} catch {
			// Ignore errors
		}
	}

	return undefined;
}

/** Save API key to auth file */
export function saveApiKey(provider: string, apiKey: string, authFilePath?: string): void {
	const dir = authFilePath ? dirname(authFilePath) : './data';
	const file = authFilePath ?? join(dir, 'auth.json');

	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	let authData: Record<string, unknown> = {};
	if (existsSync(file)) {
		try {
			authData = JSON.parse(readFileSync(file, 'utf-8'));
		} catch {
			// Start fresh
		}
	}

	authData[provider] = { apiKey, updatedAt: new Date().toISOString() };
	writeFileSync(file, JSON.stringify(authData, null, 2));
}

/** Resolve environment variable in config value (${VAR_NAME} syntax) */
export function resolveConfigValue(value: string): string {
	const match = /^\$\{([A-Z0-9_]+)\}$/.exec(value);
	return match ? process.env[match[1]] ?? value : value;
}
