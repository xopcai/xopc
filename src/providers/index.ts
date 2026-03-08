/**
 * Minimal model provider module - uses pi-ai built-in models.
 * Follows Occam's razor: no unnecessary entities.
 */

import {
	getModel as getPiAiModel,
	getModels as getPiAiModels,
	getProviders as getPiAiProviders,
	type Model,
	type Api,
} from '@mariozechner/pi-ai';
import type { Config } from '../config/schema.js';

/**
 * Resolve model reference. Supports:
 * - "provider/modelId" format
 * - "modelId" auto-detection via pi-ai
 * @throws if model not found
 */
export function resolveModel(ref: string): Model<Api> {
	if (ref.includes('/')) {
		const [provider, modelId] = ref.split('/');
		const model = getPiAiModel(provider as any, modelId as any);
		if (!model) throw new Error(`Model not found: ${ref}`);
		return model as Model<Api>;
	}

	for (const provider of getPiAiProviders()) {
		try {
			const models = getPiAiModels(provider);
			const found = models.find(m => m.id === ref);
			if (found) return found as Model<Api>;
		} catch {
			continue;
		}
	}

	throw new Error(`Model not found: ${ref}. Use format: provider/model-id`);
}

export function getModelsByProvider(provider: string): Model<Api>[] {
	try {
		return getPiAiModels(provider as any) as Model<Api>[];
	} catch {
		return [];
	}
}

export function getAllProviders(): string[] {
	return getPiAiProviders() as string[];
}

export function getApiKey(config: Config | null | undefined, provider: string): string | undefined {
	// Check config.providers (new flat format)
	if (config?.providers?.[provider]) {
		return config.providers[provider];
	}

	// Check environment variables
	const envVar = provider.toUpperCase().replace(/-/g, '_') + '_API_KEY';
	const envKey = process.env[envVar];
	if (envKey) return envKey;

	// Provider-specific env var mappings
	const envMap: Record<string, string[]> = {
		openai: ['OPENAI_API_KEY'],
		anthropic: ['ANTHROPIC_API_KEY'],
		google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
		groq: ['GROQ_API_KEY'],
		deepseek: ['DEEPSEEK_API_KEY'],
		qwen: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
		kimi: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
		minimax: ['MINIMAX_API_KEY'],
		zhipu: ['ZHIPU_API_KEY'],
		openrouter: ['OPENROUTER_API_KEY'],
		xai: ['XAI_API_KEY'],
		cerebras: ['CEREBRAS_API_KEY'],
		mistral: ['MISTRAL_API_KEY'],
	};

	const keys = envMap[provider] || [];
	for (const key of keys) {
		if (process.env[key]) return process.env[key];
	}

	return undefined;
}

export function isProviderConfigured(config: Config | null | undefined, provider: string): boolean {
	return !!getApiKey(config, provider);
}

export function getConfiguredProviders(config: Config | null | undefined): string[] {
	return getAllProviders().filter(p => isProviderConfigured(config, p));
}

export function getAllModels(): Model<Api>[] {
	return getAllProviders().flatMap(p => getModelsByProvider(p));
}

export function getAvailableModels(config: Config | null | undefined): Model<Api>[] {
	const configured = new Set(getConfiguredProviders(config));
	return getAllModels().filter(m => configured.has(m.provider));
}

export type { Model, Api } from '@mariozechner/pi-ai';

export type ProviderCategory = 'common' | 'specialty' | 'oauth' | 'enterprise';

export interface ProviderMeta {
  name: string;
  category: ProviderCategory;
  supportsOAuth?: boolean;
  supportsApiKey?: boolean;
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  'openai': { name: 'OpenAI (GPT-4, o1, o3)', category: 'common', supportsApiKey: true },
  'anthropic': { name: 'Anthropic Claude', category: 'common', supportsApiKey: true, supportsOAuth: true },
  'google': { name: 'Google Gemini', category: 'common', supportsApiKey: true },
  'groq': { name: 'Groq (Fast Inference)', category: 'common', supportsApiKey: true },
  'deepseek': { name: 'DeepSeek', category: 'common', supportsApiKey: true },
  'minimax': { name: 'MiniMax', category: 'common', supportsApiKey: true },
  'minimax-cn': { name: 'MiniMax CN', category: 'common', supportsApiKey: true },
  'kimi-coding': { name: 'Kimi For Coding', category: 'common', supportsApiKey: true },
  'xai': { name: 'xAI (Grok)', category: 'specialty', supportsApiKey: true },
  'mistral': { name: 'Mistral AI', category: 'specialty', supportsApiKey: true },
  'cerebras': { name: 'Cerebras', category: 'specialty', supportsApiKey: true },
  'openrouter': { name: 'OpenRouter (Multi-provider)', category: 'specialty', supportsApiKey: true },
  'huggingface': { name: 'Hugging Face', category: 'specialty', supportsApiKey: true },
  'opencode': { name: 'OpenCode', category: 'specialty', supportsApiKey: true },
  'zai': { name: 'z.ai', category: 'specialty', supportsApiKey: true },
  'amazon-bedrock': { name: 'Amazon Bedrock', category: 'enterprise', supportsApiKey: true },
  'azure-openai-responses': { name: 'Azure OpenAI', category: 'enterprise', supportsApiKey: true },
  'google-vertex': { name: 'Google Vertex AI', category: 'enterprise', supportsApiKey: true },
  'vercel-ai-gateway': { name: 'Vercel AI Gateway', category: 'enterprise', supportsApiKey: true },
  'github-copilot': { name: 'GitHub Copilot (OAuth)', category: 'oauth', supportsOAuth: true },
  'openai-codex': { name: 'OpenAI Codex (OAuth)', category: 'oauth', supportsOAuth: true },
  'google-gemini-cli': { name: 'Google Gemini CLI (OAuth)', category: 'oauth', supportsOAuth: true },
  'google-antigravity': { name: 'Google Antigravity (OAuth)', category: 'oauth', supportsOAuth: true },
};

export function getSortedProviders(): string[] {
  const all = getAllProviders();
  const catOrder: Record<ProviderCategory, number> = { common: 0, specialty: 1, enterprise: 2, oauth: 3 };
  
  return [...all].sort((a, b) => {
    const catA = PROVIDER_META[a]?.category ?? 'specialty';
    const catB = PROVIDER_META[b]?.category ?? 'specialty';
    if (catOrder[catA] !== catOrder[catB]) {
      return catOrder[catA] - catOrder[catB];
    }
    return a.localeCompare(b);
  });
}

export function getProviderDisplayName(provider: string): string {
  return PROVIDER_META[provider]?.name || provider;
}

export function providerSupportsOAuth(provider: string): boolean {
  return PROVIDER_META[provider]?.supportsOAuth ?? false;
}

export function providerSupportsApiKey(provider: string): boolean {
  return PROVIDER_META[provider]?.supportsApiKey ?? true;
}

export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5';

export const RECOMMENDED_MODELS = [
  'anthropic/claude-sonnet-4-5',
  'openai/gpt-4o',
  'google/gemini-2.5-flash',
  'groq/llama-3.3-70b',
  'deepseek/deepseek-chat',
] as const;

export const PROVIDER_ENV_MAP: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  'google-vertex': ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION'],
  groq: ['GROQ_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  xai: ['XAI_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  'azure-openai-responses': ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_BASE_URL'],
  'amazon-bedrock': ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
  minimax: ['MINIMAX_API_KEY'],
  'minimax-cn': ['MINIMAX_API_KEY', 'MINIMAX_CN_API_KEY'],
  'kimi-coding': ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
  huggingface: ['HF_TOKEN', 'HUGGINGFACE_TOKEN'],
  opencode: ['OPENCODE_API_KEY'],
  zai: ['ZAI_API_KEY'],
};

export const PROVIDER_PREFIX_PATTERNS: Record<string, string[]> = {
  openai: ['gpt-', 'o1', 'o3', 'o4', 'chatgpt-'],
  anthropic: ['claude-'],
  google: ['gemini-', 'gemma-'],
  xai: ['grok-'],
  groq: ['llama-', 'mixtral-', 'gemma-'],
  deepseek: ['deepseek-', 'r1'],
  mistral: ['mistral-'],
  cerebras: ['llama-'],
  openrouter: [],
};

export function detectProvider(modelId: string): string | undefined {
  const lowerId = modelId.toLowerCase();
  
  for (const [provider, prefixes] of Object.entries(PROVIDER_PREFIX_PATTERNS)) {
    if (prefixes.some(p => lowerId.startsWith(p))) {
      return provider;
    }
  }
  
  for (const provider of getAllProviders()) {
    try {
      const models = getPiAiModels(provider as any);
      if (models.some(m => m.id === modelId)) {
        return provider;
      }
    } catch {
      continue;
    }
  }
  
  return undefined;
}

export function getProviderEnvVars(provider: string): string[] {
  return PROVIDER_ENV_MAP[provider] || [`${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`];
}
