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
import { CredentialResolver, resolveApiKey, hasCredentials } from '../auth/credentials.js';
import { hasProviderAuthOnDiskSync } from '../auth/sync-provider-auth.js';
import { getApiKeyFromEnv } from './env-keys.js';
import { getProviderRegistry } from './plugin-registry.js';
import type { ProviderModelDefinition } from '../extensions/types/providers.js';

export { getApiKeyFromEnv, PROVIDER_ENV_MAP } from './env-keys.js';

/** Sentinel base URL: model is served by an extension {@link ProviderPluginRegistry} provider. */
export const EXTENSION_PROVIDER_BASE_URL = 'extension://provider-plugin';

/** Map a plugin registry model to the pi-ai {@link Model} shape. */
export function pluginModelToModel(providerId: string, definition: ProviderModelDefinition): Model<Api> {
	return {
		provider: providerId,
		id: definition.id,
		name: definition.name,
		api: 'openai-completions' as Api,
		baseUrl: EXTENSION_PROVIDER_BASE_URL,
		reasoning: false,
		input: definition.supportsImages ? (['text', 'image'] as ('text' | 'image')[]) : (['text'] as ('text' | 'image')[]),
		contextWindow: definition.contextWindow ?? 128000,
		maxTokens: definition.maxOutputTokens ?? 4096,
		cost: {
			input: definition.pricing?.input ?? 0,
			output: definition.pricing?.output ?? 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
	} as Model<Api>;
}

/**
 * Get API key synchronously: checks registry (models.json) first, then environment variables.
 * Use this for Agent's getApiKey callback which must be synchronous.
 */
export function getApiKeySync(provider: string): string | undefined {
  const pluginRegistry = getProviderRegistry();
  if (pluginRegistry.has(provider)) return 'extension-managed';

  const registry = getModelRegistry();
  const registryKey = registry.getApiKey(provider);
  if (registryKey) {
    return registryKey;
  }
  return getApiKeyFromEnv(provider);
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

	if (ref.includes('/')) {
		const [provider, modelId] = ref.split('/');
		const piAiModel = getPiAiModel(provider as any, modelId as any);
		if (piAiModel) return piAiModel as Model<Api>;

		const pluginRegistry = getProviderRegistry();
		const plugin = pluginRegistry.get(provider);
		if (plugin) {
			const pluginModel = plugin.models.find(m => m.id === modelId);
			if (pluginModel) return pluginModelToModel(provider, pluginModel);
		}
		throw new Error(`Model not found: ${ref}`);
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

	const pluginRegistry = getProviderRegistry();
	for (const plugin of pluginRegistry.listAll()) {
		const found = plugin.models.find(m => m.id === ref);
		if (found) return pluginModelToModel(plugin.id, found);
	}

	throw new Error(`Model not found: ${ref}. Use format: provider/model-id`);
}

export function getModelsByProvider(provider: string): readonly Model<Api>[] {
	const registry = getModelRegistry();
	const fromRegistry = registry.getAll().filter(m => m.provider === provider);
	const plugin = getProviderRegistry().get(provider);
	if (!plugin) return fromRegistry;
	const pluginModels = plugin.models.map(m => pluginModelToModel(provider, m));
	return [...fromRegistry, ...pluginModels];
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

	for (const plugin of getProviderRegistry().listAll()) {
		providers.add(plugin.id);
	}

	return Array.from(providers);
}

export async function getApiKey(provider: string): Promise<string | undefined> {
	if (getProviderRegistry().has(provider)) return 'extension-managed';

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
 * Synchronous version for use in non-async contexts
 * Only checks environment variables and registry, not credential system
 */
export function isProviderConfiguredSync(provider: string): boolean {
	if (getProviderRegistry().has(provider)) return true;

	// Check registry for custom providers
	const registry = getModelRegistry();
	if (registry.getApiKey(provider)) {
		return true;
	}
	// Check environment variables
	if (getApiKeyFromEnv(provider)) {
		return true;
	}
	// Gateway UI / CLI store keys in auth-profiles.json (async CredentialResolver); sync path for fallback list
	return hasProviderAuthOnDiskSync(provider);
}

export async function isProviderConfigured(provider: string): Promise<boolean> {
  if (getProviderRegistry().has(provider)) return true;

  // Check registry first for custom providers (from models.json)
  const registry = getModelRegistry();
  if (registry.getApiKey(provider)) {
    return true;
  }
  return await hasCredentials(provider);
}

/** Where runtime {@link getApiKey} resolves the key from (no secret values). */
export type ProviderActiveKeySource = 'none' | 'agent' | 'gateway' | 'oauth' | 'env' | 'models_json' | 'extension';

export async function getProviderActiveKeySource(provider: string): Promise<ProviderActiveKeySource> {
  if (getProviderRegistry().has(provider)) return 'extension';

  const resolver = new CredentialResolver();
  const fromCredentials = await resolver.resolveApiKeySource(provider);
  if (fromCredentials === 'agent') return 'agent';
  if (fromCredentials === 'global') return 'gateway';
  if (fromCredentials === 'oauth') return 'oauth';
  if (fromCredentials === 'env') return 'env';

  const registry = getModelRegistry();
  if (registry.getApiKey(provider)) {
    return 'models_json';
  }

  return 'none';
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
	const registryModels = registry.getAll();
	const pluginProviders = getProviderRegistry().listAll();
	if (pluginProviders.length === 0) return registryModels;

	const existingIds = new Set(registryModels.map(m => `${m.provider}/${m.id}`));
	const merged: Model<Api>[] = [...registryModels];
	for (const plugin of pluginProviders) {
		for (const model of plugin.models) {
			const compositeId = `${plugin.id}/${model.id}`;
			if (!existingIds.has(compositeId)) {
				merged.push(pluginModelToModel(plugin.id, model));
				existingIds.add(compositeId);
			}
		}
	}
	return merged;
}

export async function getAvailableModels(): Promise<readonly Model<Api>[]> {
	const allModels = getAllModels();
	const pluginRegistry = getProviderRegistry();
	const available: Model<Api>[] = [];

	for (const model of allModels) {
		if (pluginRegistry.has(model.provider)) {
			available.push(model);
		} else if (await isProviderConfigured(model.provider)) {
			available.push(model);
		}
	}
	return available;
}

export type { Model, Api } from '@mariozechner/pi-ai';

export type ProviderCategory = 'common' | 'specialty' | 'oauth' | 'enterprise' | 'extension';

export interface ProviderMeta {
  name: string;
  category: ProviderCategory;
  supportsOAuth?: boolean;
  supportsApiKey?: boolean;
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  'openai': { name: 'OpenAI (GPT-4, o1, o3)', category: 'common', supportsApiKey: true },
  'anthropic': { name: 'Anthropic Claude', category: 'common', supportsApiKey: true, supportsOAuth: true },
  'deepseek': { name: 'DeepSeek', category: 'common', supportsApiKey: true },
  'google': { name: 'Google Gemini', category: 'common', supportsApiKey: true },
  'groq': { name: 'Groq (Fast Inference)', category: 'common', supportsApiKey: true },
  'minimax': { name: 'MiniMax', category: 'common', supportsApiKey: true, supportsOAuth: true },
  'minimax-cn': { name: 'MiniMax CN', category: 'common', supportsApiKey: true, supportsOAuth: true },
  'kimi-coding': { name: 'Kimi For Coding', category: 'common', supportsApiKey: true, supportsOAuth: true },
  'xai': { name: 'xAI (Grok)', category: 'specialty', supportsApiKey: true },
  'mistral': { name: 'Mistral AI', category: 'specialty', supportsApiKey: true },
  'cerebras': { name: 'Cerebras', category: 'specialty', supportsApiKey: true },
  'openrouter': { name: 'OpenRouter (Multi-provider)', category: 'specialty', supportsApiKey: true },
  'huggingface': { name: 'Hugging Face', category: 'specialty', supportsApiKey: true },
  'opencode': { name: 'OpenCode', category: 'specialty', supportsApiKey: true },
  'opencode-go': { name: 'OpenCode Go', category: 'specialty', supportsApiKey: true },
  /** DashScope (Alibaba) — image, speech, STT; not an LLM KnownProvider. */
  'dashscope': { name: 'DashScope (Alibaba)', category: 'specialty', supportsApiKey: true },
  /** International GLM (api.z.ai). Auth: API key (ZAI_API_KEY); no published OAuth for this HTTP API. */
  'zai': { name: 'Zhipu GLM (International · z.ai)', category: 'common', supportsApiKey: true },
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
  const catOrder: Record<ProviderCategory, number> = { common: 0, specialty: 1, enterprise: 2, oauth: 3, extension: 4 };
  const pluginRegistry = getProviderRegistry();

  return [...all].sort((a, b) => {
    const catA = pluginRegistry.has(a) ? 'extension' : (PROVIDER_META[a]?.category ?? 'specialty');
    const catB = pluginRegistry.has(b) ? 'extension' : (PROVIDER_META[b]?.category ?? 'specialty');
    if (catOrder[catA] !== catOrder[catB]) {
      return catOrder[catA] - catOrder[catB];
    }
    return a.localeCompare(b);
  });
}

export function getProviderDisplayName(provider: string): string {
  const plugin = getProviderRegistry().get(provider);
  if (plugin) return plugin.name;
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
