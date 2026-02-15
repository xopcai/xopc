/**
 * Models.dev Provider
 *
 * Fetches model data from models.dev API and transforms it for use in xopcbot.
 * Models.dev is a comprehensive open-source database of AI model specifications.
 *
 * API: https://models.dev/api.json
 */

import type { Api, Model } from '@mariozechner/pi-ai';

/** Supported providers that map from models.dev to xopcbot */
const PROVIDER_MAPPING: Record<string, { xopcbotId: string; baseUrl?: string; envKey?: string }> = {
	'zhipuai': { xopcbotId: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', envKey: 'ZHIPU_API_KEY' },
	'minimax': { xopcbotId: 'minimax', baseUrl: 'https://api.minimax.io/v1', envKey: 'MINIMAX_API_KEY' },
	'moonshotai': { xopcbotId: 'kimi', baseUrl: 'https://api.moonshot.cn/v1', envKey: 'KIMI_API_KEY' },
	'qwen': { xopcbotId: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', envKey: 'QWEN_API_KEY' },
	'deepseek': { xopcbotId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', envKey: 'DEEPSEEK_API_KEY' },
	'groq': { xopcbotId: 'groq', baseUrl: 'https://api.groq.com/openai/v1', envKey: 'GROQ_API_KEY' },
	'openai': { xopcbotId: 'openai', baseUrl: 'https://api.openai.com/v1', envKey: 'OPENAI_API_KEY' },
	'anthropic': { xopcbotId: 'anthropic', baseUrl: 'https://api.anthropic.com', envKey: 'ANTHROPIC_API_KEY' },
	'google': { xopcbotId: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1', envKey: 'GOOGLE_API_KEY' },
	'xai': { xopcbotId: 'xai', baseUrl: 'https://api.x.ai/v1', envKey: 'XAI_API_KEY' },
	'mistral': { xopcbotId: 'mistral', baseUrl: 'https://api.mistral.ai/v1', envKey: 'MISTRAL_API_KEY' },
	'cerebras': { xopcbotId: 'cerebras', baseUrl: 'https://api.cerebras.ai/v1', envKey: 'CEREBRAS_API_KEY' },
	'openrouter': { xopcbotId: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', envKey: 'OPENROUTER_API_KEY' },
};

interface ModelsDevProvider {
	id: string;
	env?: string[];
	npm?: string;
	api?: string;
	name?: string;
	doc?: string;
	models: Record<string, ModelsDevModel>;
}

interface ModelsDevModel {
	id: string;
	name: string;
	family?: string;
	attachment?: boolean;
	reasoning?: boolean;
	tool_call?: boolean;
	temperature?: boolean;
	structured_output?: boolean;
	modalities?: { input: string[]; output: string[] };
	open_weights?: boolean;
	cost?: { input: number; output: number; cache_read?: number; cache_write?: number };
	limit?: { context: number; output: number };
	release_date?: string;
	last_updated?: string;
}

/** Cache for models.dev data */
let cachedModels: Map<string, Model<Api>[]> | null = null;
let cacheTime: number = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

/**
 * Transform a models.dev model to our internal format
 */
function transformModel(
	providerId: string,
	modelId: string,
	model: ModelsDevModel,
	mapping: { xopcbotId: string; baseUrl?: string }
): Model<Api> {
	const inputModalities = model.modalities?.input ?? ['text'];
	const supportsVision = inputModalities.includes('image') || inputModalities.includes('video');

	return {
		id: modelId,
		name: model.name,
		api: 'openai-completions' as Api,
		provider: mapping.xopcbotId,
		baseUrl: mapping.baseUrl ?? '',
		reasoning: model.reasoning ?? false,
		input: supportsVision ? (['text', 'image'] as const) : (['text'] as const),
				cost: {
					input: model.cost?.input ?? 0,
					output: model.cost?.output ?? 0,
					cacheRead: model.cost?.cache_read ?? 0,
					cacheWrite: model.cost?.cache_write ?? 0,
				},
		contextWindow: model.limit?.context ?? 128000,
		maxTokens: model.limit?.output ?? 8192,
	};
}

/**
 * Fetch models from models.dev API
 */
export async function fetchModelsDevModels(): Promise<Map<string, Model<Api>[]>> {
	// Check cache first
	if (cachedModels && Date.now() - cacheTime < CACHE_TTL) {
		return cachedModels;
	}

	try {
		const response = await fetch('https://models.dev/api.json', {
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch models.dev: ${response.status}`);
		}

		const data = (await response.json()) as Record<string, ModelsDevProvider>;
		const models = new Map<string, Model<Api>[]>();

		// Process each provider
		for (const [mdProviderId, providerData] of Object.entries(data)) {
			const mapping = PROVIDER_MAPPING[mdProviderId];
			if (!mapping) continue;

			const providerModels: Model<Api>[] = [];

			for (const [modelId, modelData] of Object.entries(providerData.models)) {
				// Skip open weights models for now (they have different API)
				if (modelData.open_weights) continue;

				try {
					const transformed = transformModel(mdProviderId, modelId, modelData, mapping);
					providerModels.push(transformed);
				} catch {
					// Skip invalid models
				}
			}

			if (providerModels.length > 0) {
				models.set(mapping.xopcbotId, providerModels);
			}
		}

		// Update cache
		cachedModels = models;
		cacheTime = Date.now();

		return models;
	} catch (error) {
		console.warn('Failed to fetch models.dev data:', error);
		// Return cached data if available, even if expired
		if (cachedModels) {
			return cachedModels;
		}
		return new Map();
	}
}

/**
 * Get models for a specific provider from models.dev
 */
export async function getModelsDevModelsForProvider(provider: string): Promise<Model<Api>[]> {
	const allModels = await fetchModelsDevModels();
	return allModels.get(provider) ?? [];
}

/**
 * Clear the cache (useful for testing or manual refresh)
 */
export function clearModelsDevCache(): void {
	cachedModels = null;
	cacheTime = 0;
}

/**
 * Get provider info from models.dev
 */
export interface ModelsDevProviderInfo {
	id: string;
	name: string;
	api?: string;
	envKey?: string;
}

export async function getModelsDevProviders(): Promise<ModelsDevProviderInfo[]> {
	const allModels = await fetchModelsDevModels();
	const providers: ModelsDevProviderInfo[] = [];

	for (const [xopcbotId, models] of allModels) {
		// Find the reverse mapping
		const mapping = Object.entries(PROVIDER_MAPPING).find(([_, m]) => m.xopcbotId === xopcbotId);
		if (mapping) {
			providers.push({
				id: xopcbotId,
				name: models[0]?.provider ?? xopcbotId,
				api: mapping[1].baseUrl,
				envKey: mapping[1].envKey,
			});
		}
	}

	return providers;
}
