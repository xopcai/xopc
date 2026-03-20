/**
 * Model provider module - integrates built-in models with custom models from models.json
 */

import {
	getModel as getPiAiModel,
	getModels as getPiAiModels,
	getProviders as getPiAiProviders,
	type Model,
	type Api,
} from '@mariozechner/pi-ai';
import type { Config } from '../config/schema.js';
import { getModelRegistry } from './model-registry.js';
import { resolveApiKey, hasCredentials } from '../auth/credentials.js';

// ============================================
// Provider Environment Variable Mappings
// ============================================
// Unified mapping of provider -> environment variable names
// This is the single source of truth for API key resolution

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
	'minimax-cn': ['MINIMAX_API_KEY'],
	'kimi-coding': ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
	huggingface: ['HF_TOKEN', 'HUGGINGFACE_TOKEN'],
	opencode: ['OPENCODE_API_KEY'],
	zai: ['ZAI_API_KEY'],
	zhipu: ['ZHIPU_API_KEY'],
	qwen: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
	kimi: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
	'google-gemini-cli': ['GEMINI_CLI_TOKEN', 'GOOGLE_TOKEN'],
	'google-antigravity': ['ANTIGRAVITY_API_KEY'],
	vercel: ['VERCEL_TOKEN'],
	'vercel-ai-gateway': ['VERCEL_AI_GATEWAY_API_KEY'],
	'github-copilot': ['GITHUB_TOKEN', 'GITHUB_COPILOT_TOKEN'],
};

/**
 * Get API key from environment variables for a provider
 */
export function getApiKeyFromEnv(provider: string): string | undefined {
	// Standard format: PROVIDER_API_KEY
	const envVar = provider.toUpperCase().replace(/-/g, '_') + '_API_KEY';
	const envKey = process.env[envVar];
	if (envKey) return envKey;

	// Provider-specific env var mappings
	const keys = PROVIDER_ENV_MAP[provider] || [];
	for (const key of keys) {
		if (process.env[key]) return process.env[key];
	}

	return undefined;
}

/**
 * Resolve model reference. Supports:
 * - "provider/modelId" format
 * - "modelId" auto-detection via pi-ai or custom models
 * @throws if model not found
 */
export function resolveModel(ref: string): Model<Api> {
	// First try ModelRegistry (includes custom models)
	const registry = getModelRegistry();
	const customModel = registry.resolve(ref);
	if (customModel) {
		return customModel;
	}

	// Fall back to built-in models
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

export function getModelsByProvider(provider: string): readonly Model<Api>[] {
	// Get from registry (includes custom models)
	const registry = getModelRegistry();
	return registry.getAll().filter(m => m.provider === provider);
}

export function getAllProviders(): string[] {
	const registry = getModelRegistry();
	const providers = new Set<string>();
	
	// Add built-in providers
	for (const p of getPiAiProviders()) {
		providers.add(p);
	}
	
	// Add custom providers from registry
	for (const m of registry.getAll()) {
		providers.add(m.provider);
	}
	
	return Array.from(providers);
}

export async function getApiKey(provider: string): Promise<string | undefined> {
	// Use new credential resolver first (checks: agent private > global > oauth > env)
	const credentialKey = await resolveApiKey(provider);
	if (credentialKey) {
		return credentialKey;
	}

	// Check registry for custom providers (from models.json)
	const registry = getModelRegistry();
	const registryKey = registry.getApiKey(provider);
	if (registryKey) {
		return registryKey;
	}

	// Fallback to environment variables
	return getApiKeyFromEnv(provider);
}

/**
 * @deprecated Use async getApiKey() instead
 */
export function getApiKeySync(config: Config | null | undefined, provider: string): string | undefined {
	// Legacy fallback - check registry and env only
	const registry = getModelRegistry();
	const registryKey = registry.getApiKey(provider);
	if (registryKey) {
		return registryKey;
	}
	return getApiKeyFromEnv(provider);
}

export async function isProviderConfigured(provider: string): Promise<boolean> {
	return await hasCredentials(provider);
}

/**
 * @deprecated Use async isProviderConfigured() instead
 */
export function isProviderConfiguredSync(config: Config | null | undefined, provider: string): boolean {
	return !!getApiKeySync(config, provider);
}

export async function getConfiguredProviders(): Promise<string[]> {
	const allProviders = getAllProviders();
	const configured: string[] = [];
	for (const p of allProviders) {
		if (await isProviderConfigured(p)) {
			configured.push(p);
		}
	}
	return configured;
}

export function getAllModels(): readonly Model<Api>[] {
	const registry = getModelRegistry();
	return registry.getAll();
}

export async function getAvailableModels(): Promise<readonly Model<Api>[]> {
	const registry = getModelRegistry();
	const allModels = registry.getAll();
	
	// Filter models by checking if provider has auth configured
	const available: Model<Api>[] = [];
	for (const model of allModels) {
		if (await isProviderConfigured(model.provider)) {
			available.push(model);
		}
	}
	return available;
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

// ============================================
// Dynamic Default Model Resolution
// ============================================

/**
 * Get a default model reference.
 * Priority:
 * 1. First available model with configured API key
 * 2. First model from pi-ai catalog
 * 3. Fallback to anthropic/claude-sonnet-4-5 as last resort
 */
export async function getDefaultModel(config?: Config | null | undefined): Promise<string> {
  const availableModels = await getAvailableModels();
  
  // Try to find configured default model first
  const defaultModel = config?.agents?.defaults?.model;
  if (defaultModel) {
    const modelRef = typeof defaultModel === 'string' ? defaultModel : defaultModel.primary;
    if (modelRef) {
      // Check if the configured model has valid API key
      const configured = availableModels.find(m => 
        `${m.provider}/${m.id}` === modelRef ||
        m.id === modelRef
      );
      if (configured) {
        return `${configured.provider}/${configured.id}`;
      }
    }
  }
  
  // Return first available model
  if (availableModels.length > 0) {
    return `${availableModels[0].provider}/${availableModels[0].id}`;
  }
  
  // Try to get first model from pi-ai catalog
  for (const provider of getPiAiProviders()) {
    try {
      const models = getPiAiModels(provider);
      if (models.length > 0) {
        return `${provider}/${models[0].id}`;
      }
    } catch {
      continue;
    }
  }
  
  // Last resort fallback
  return 'anthropic/claude-sonnet-4-5';
}

/**
 * Synchronous default model resolution for constructors and sync code paths.
 * Uses catalog/registry only (no async credential checks).
 */
export function getDefaultModelSync(config?: Config | null | undefined): string {
  const defaultModel = config?.agents?.defaults?.model;
  if (defaultModel) {
    const modelRef = typeof defaultModel === 'string' ? defaultModel : defaultModel.primary;
    if (modelRef) {
      return modelRef;
    }
  }
  const all = getAllModels();
  if (all.length > 0) {
    return `${all[0].provider}/${all[0].id}`;
  }
  for (const provider of getPiAiProviders()) {
    try {
      const models = getPiAiModels(provider);
      if (models.length > 0) {
        return `${provider}/${models[0].id}`;
      }
    } catch {
      continue;
    }
  }
  return 'anthropic/claude-sonnet-4-5';
}

// Re-export ModelRegistry for advanced use cases
export { ModelRegistry, getModelRegistry, resetModelRegistry } from './model-registry.js';
