/**
 * Model provider module - integrates built-in models with custom models from models.json
 */

import {
	getModel as getPiAiModel,
	getModels as getPiAiModels,
	getProviders as getPiAiProviders,
	type Model,
	type Api,
} from '@earendil-works/pi-ai/compat';
import { getAgentDefaultModelRef, type Config } from '../config/schema.js';
import { getModelRegistry } from './model-registry.js';
import {
	CredentialResolver,
	resolveApiKey,
	hasCredentials,
	type CredentialResolverOptions,
} from '../auth/credentials.js';
import { hasProviderAuthOnDiskSync } from '../auth/sync-provider-auth.js';
import { getApiKeyFromEnv } from './env-keys.js';
import { EXTENSION_PROVIDER_BASE_URL } from './constants.js';
import { getSupplementalModels } from './model-supplements.js';
import { getProviderRegistry } from './plugin-registry.js';
import type { ProviderModelDefinition } from '../extensions/types/providers.js';

export { EXTENSION_PROVIDER_BASE_URL } from './constants.js';
export { getApiKeyFromEnv, PROVIDER_ENV_MAP } from './env-keys.js';
const OPENAI_CODEX_CANONICAL_BASE_URL = 'https://chatgpt.com/backend-api/codex';

function normalizeProviderModel(model: Model<Api>): Model<Api> {
	if (model.provider === 'openai-codex' && model.api === 'openai-codex-responses') {
		return { ...model, baseUrl: OPENAI_CODEX_CANONICAL_BASE_URL } as Model<Api>;
	}
	return model;
}

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
	const trimmedRef = typeof ref === 'string' ? ref.trim() : '';
	if (!trimmedRef) {
		throw new Error(
			'No default model configured. Choose a model in onboarding or set agents.capabilityPresets.default.models.roles.<role>.model.',
		);
	}

	// First try ModelRegistry (includes custom models)
	const registry = getModelRegistry();
	const customModel = registry.resolve(trimmedRef);
	if (customModel) {
		return customModel;
	}

	if (trimmedRef.includes('/')) {
		const [provider, modelId] = trimmedRef.split('/');
		const piAiModel = getPiAiModel(provider as any, modelId as any);
		if (piAiModel) return normalizeProviderModel(piAiModel as Model<Api>);

		const supplementalModel = getSupplementalModels().find(m => m.provider === provider && m.id === modelId);
		if (supplementalModel) return normalizeProviderModel(supplementalModel);

		const pluginRegistry = getProviderRegistry();
		const plugin = pluginRegistry.get(provider);
		if (plugin) {
			const pluginModel = plugin.models.find(m => m.id === modelId);
			if (pluginModel) return pluginModelToModel(provider, pluginModel);
		}
		throw new Error(`Model not found: ${trimmedRef}`);
	}

	for (const provider of getPiAiProviders()) {
		try {
			const models = getPiAiModels(provider);
			const found = models.find(m => m.id === trimmedRef);
			if (found) return normalizeProviderModel(found as Model<Api>);
		} catch {
			continue;
		}
	}

	const supplementalModel = getSupplementalModels().find(m => m.id === trimmedRef);
	if (supplementalModel) return normalizeProviderModel(supplementalModel);

	const pluginRegistry = getProviderRegistry();
	for (const plugin of pluginRegistry.listAll()) {
		const found = plugin.models.find(m => m.id === trimmedRef);
		if (found) return pluginModelToModel(plugin.id, found);
	}

	throw new Error(`Model not found: ${trimmedRef}. Use format: provider/model-id`);
}

export function getModelsByProvider(provider: string): readonly Model<Api>[] {
	const registry = getModelRegistry();
	const fromRegistry = registry.getAll().filter(m => m.provider === provider).map(normalizeProviderModel);
	const existingIds = new Set(fromRegistry.map(m => m.id));
	const supplementalModels = getSupplementalModels()
		.filter(m => m.provider === provider && !existingIds.has(m.id))
		.map(normalizeProviderModel);
	const plugin = getProviderRegistry().get(provider);
	if (!plugin) return [...fromRegistry, ...supplementalModels];
	const pluginModels = plugin.models.map(m => pluginModelToModel(provider, m));
	return [...fromRegistry, ...supplementalModels, ...pluginModels];
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

export async function getApiKey(
	provider: string,
	credentialOptions?: CredentialResolverOptions,
): Promise<string | undefined> {
	if (getProviderRegistry().has(provider)) return 'extension-managed';

	// Use new credential resolver first (checks: agent private > global > oauth > env)
	const credentialKey = await resolveApiKey(provider, credentialOptions);
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

export type ProviderAuthMode = ProviderActiveKeySource;
export type ProviderAuthStatus = 'connected' | 'expired' | 'not_connected';

export interface ProviderAuthState {
  authMode: ProviderAuthMode;
  authStatus: ProviderAuthStatus;
  expiresAt?: number;
}

export async function getProviderActiveKeySource(provider: string): Promise<ProviderActiveKeySource> {
  const authState = await getProviderAuthState(provider);
  return authState.authMode;
}

export async function getProviderAuthState(provider: string): Promise<ProviderAuthState> {
  if (getProviderRegistry().has(provider)) {
    return { authMode: 'extension', authStatus: 'connected' };
  }

  const resolver = new CredentialResolver();
  const fromCredentials = await resolver.resolveApiKeySource(provider);
  if (fromCredentials === 'agent') return { authMode: 'agent', authStatus: 'connected' };
  if (fromCredentials === 'global') return { authMode: 'gateway', authStatus: 'connected' };
  if (fromCredentials === 'oauth') {
    const token = await resolver.loadOAuthTokenRecord(provider);
    const expired = Boolean(token?.expiresAt && token.expiresAt < Date.now());
    return {
      authMode: 'oauth',
      authStatus: expired ? 'expired' : 'connected',
      ...(token?.expiresAt ? { expiresAt: token.expiresAt } : {}),
    };
  }
  if (fromCredentials === 'env') return { authMode: 'env', authStatus: 'connected' };

  const expiredOAuthToken = await resolver.loadOAuthTokenRecord(provider);
  if (expiredOAuthToken?.expiresAt && expiredOAuthToken.expiresAt < Date.now()) {
    return {
      authMode: 'oauth',
      authStatus: 'expired',
      expiresAt: expiredOAuthToken.expiresAt,
    };
  }

  const registry = getModelRegistry();
  if (registry.getApiKey(provider)) {
    return { authMode: 'models_json', authStatus: 'connected' };
  }

  return { authMode: 'none', authStatus: 'not_connected' };
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
	const registryModels = registry.getAll().map(normalizeProviderModel);
	const existingIds = new Set(registryModels.map(m => `${m.provider}/${m.id}`));
	const supplementalModels = getSupplementalModels()
		.filter(m => !existingIds.has(`${m.provider}/${m.id}`))
		.map(normalizeProviderModel);
	for (const model of supplementalModels) {
		existingIds.add(`${model.provider}/${model.id}`);
	}
	const pluginProviders = getProviderRegistry().listAll();
	if (pluginProviders.length === 0) return [...registryModels, ...supplementalModels];

	const merged: Model<Api>[] = [...registryModels, ...supplementalModels];
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
	const configuredByProvider = new Map<string, boolean>();

	for (const model of allModels) {
		if (pluginRegistry.has(model.provider)) {
			available.push(model);
			continue;
		}
		let configured = configuredByProvider.get(model.provider);
		if (configured === undefined) {
			configured = await isProviderConfigured(model.provider);
			configuredByProvider.set(model.provider, configured);
		}
		if (configured) {
			available.push(model);
		}
	}
	return available;
}

export type { Model, Api } from '@earendil-works/pi-ai';

export type ProviderCategory = 'common' | 'domestic' | 'specialty' | 'oauth' | 'enterprise' | 'extension';

export interface ProviderMeta {
  name: string;
  category: ProviderCategory;
  supportsOAuth?: boolean;
  supportsApiKey?: boolean;
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  'openai': { name: 'OpenAI', category: 'common', supportsApiKey: true },
  'anthropic': { name: 'Anthropic', category: 'common', supportsApiKey: true, supportsOAuth: true },
  'deepseek': { name: 'DeepSeek', category: 'domestic', supportsApiKey: true },
  'google': { name: 'Google AI', category: 'common', supportsApiKey: true },
  'groq': { name: 'Groq', category: 'common', supportsApiKey: true },
  'minimax': { name: 'MiniMax', category: 'domestic', supportsApiKey: true, supportsOAuth: true },
  'minimax-cn': { name: 'MiniMax CN', category: 'domestic', supportsApiKey: true, supportsOAuth: true },
  'kimi-coding': { name: 'Kimi For Coding', category: 'domestic', supportsApiKey: true, supportsOAuth: true },
  'xai': { name: 'xAI', category: 'specialty', supportsApiKey: true },
  'mistral': { name: 'Mistral AI', category: 'specialty', supportsApiKey: true },
  'cerebras': { name: 'Cerebras', category: 'specialty', supportsApiKey: true },
  'openrouter': { name: 'OpenRouter', category: 'specialty', supportsApiKey: true },
  'huggingface': { name: 'Hugging Face', category: 'specialty', supportsApiKey: true },
  moonshotai: { name: 'Moonshot AI (Kimi · International)', category: 'domestic', supportsApiKey: true },
  'moonshotai-cn': { name: 'Moonshot AI (Kimi · China)', category: 'domestic', supportsApiKey: true },
  fireworks: { name: 'Fireworks AI', category: 'specialty', supportsApiKey: true },
  together: { name: 'Together AI', category: 'specialty', supportsApiKey: true },
  'cloudflare-workers-ai': { name: 'Cloudflare Workers AI', category: 'enterprise', supportsApiKey: true },
  'cloudflare-ai-gateway': { name: 'Cloudflare AI Gateway', category: 'enterprise', supportsApiKey: true },
  xiaomi: { name: 'Xiaomi Mimo', category: 'domestic', supportsApiKey: true },
  'xiaomi-token-plan-cn': { name: 'Xiaomi Token Plan (CN)', category: 'domestic', supportsApiKey: true },
  'xiaomi-token-plan-ams': { name: 'Xiaomi Token Plan (AMS)', category: 'domestic', supportsApiKey: true },
  'xiaomi-token-plan-sgp': { name: 'Xiaomi Token Plan (SGP)', category: 'domestic', supportsApiKey: true },
  'opencode': { name: 'OpenCode', category: 'specialty', supportsApiKey: true },
  'opencode-go': { name: 'OpenCode Go', category: 'specialty', supportsApiKey: true },
  'dashscope': { name: 'DashScope (Alibaba)', category: 'domestic', supportsApiKey: true },
  'dashscope-cn': { name: 'Alibaba Bailian / DashScope China', category: 'domestic', supportsApiKey: true },
  'dashscope-intl': { name: 'Alibaba Bailian / DashScope International', category: 'domestic', supportsApiKey: true },
  'volcengine-ark': { name: 'Volcengine Ark', category: 'domestic', supportsApiKey: true },
  'volcengine-plan': { name: 'Volcengine Doubao Coding Plan', category: 'domestic', supportsApiKey: true },
  'byteplus-plan': { name: 'BytePlus Doubao Coding Plan', category: 'domestic', supportsApiKey: true },
  'stepfun': { name: 'StepFun', category: 'domestic', supportsApiKey: true },
  'stepfun-cn': { name: 'StepFun China', category: 'domestic', supportsApiKey: true },
  'stepfun-intl': { name: 'StepFun International', category: 'domestic', supportsApiKey: true },
  'stepfun-plan': { name: 'StepFun Step Plan', category: 'domestic', supportsApiKey: true },
  'stepfun-plan-cn': { name: 'StepFun Step Plan China', category: 'domestic', supportsApiKey: true },
  'stepfun-plan-intl': { name: 'StepFun Step Plan International', category: 'domestic', supportsApiKey: true },
  'ant-ling': { name: 'Ant Ling', category: 'domestic', supportsApiKey: true },
  'zhipu-cn': { name: 'Zhipu GLM (China)', category: 'domestic', supportsApiKey: true },
  'zai-coding-cn': { name: 'Zhipu GLM Coding Plan (China)', category: 'domestic', supportsApiKey: true },
  'zai-coding-global': { name: 'Zhipu GLM Coding Plan (International)', category: 'domestic', supportsApiKey: true },
  'zhipu-coding-cn': { name: 'Zhipu GLM Coding Plan (China)', category: 'domestic', supportsApiKey: true },
  /** International GLM (api.z.ai). Auth: API key (ZAI_API_KEY); no published OAuth for this HTTP API. */
  'zai': { name: 'Zhipu GLM (International · z.ai)', category: 'domestic', supportsApiKey: true },
  'amazon-bedrock': { name: 'Amazon Bedrock', category: 'enterprise', supportsApiKey: true },
  'azure-openai-responses': { name: 'Azure OpenAI', category: 'enterprise', supportsApiKey: true },
  'google-vertex': { name: 'Google Vertex AI', category: 'enterprise', supportsApiKey: true },
  'vercel-ai-gateway': { name: 'Vercel AI Gateway', category: 'enterprise', supportsApiKey: true },
  'github-copilot': { name: 'GitHub Copilot (OAuth)', category: 'oauth', supportsOAuth: true, supportsApiKey: false },
  'openai-codex': { name: 'OpenAI Codex (OAuth)', category: 'oauth', supportsOAuth: true, supportsApiKey: false },
  'google-gemini-cli': { name: 'Google Gemini CLI (OAuth)', category: 'oauth', supportsOAuth: true, supportsApiKey: false },
  'google-antigravity': { name: 'Google Antigravity (OAuth)', category: 'oauth', supportsOAuth: true, supportsApiKey: false },
};

export function getSortedProviders(): string[] {
  const all = getAllProviders();
  const catOrder: Record<ProviderCategory, number> = {
    common: 0,
    domestic: 1,
    specialty: 2,
    enterprise: 3,
    oauth: 4,
    extension: 5,
  };
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
 * 1. Effective model inherited from the global default preset / agent presets / agent override
 * 2. Empty string only when no default model is present in the loaded config
 */
export async function getDefaultModel(config?: Config | null | undefined): Promise<string> {
  const modelRef = config ? getAgentDefaultModelRef(config) : undefined;
  if (modelRef) {
    const availableModels = await getAvailableModels();
    const configured = availableModels.find(m =>
      `${m.provider}/${m.id}` === modelRef ||
      m.id === modelRef
    );
    if (configured) {
      return `${configured.provider}/${configured.id}`;
    }
    return modelRef;
  }

  return '';
}

/**
 * Synchronous default model resolution for constructors and sync code paths.
 * Uses catalog/registry only (no async credential checks).
 *
 * When no model is present in the loaded config, returns an empty string so
 * setup flows can prompt for the global default model.
 */
export function getDefaultModelSync(config?: Config | null | undefined): string {
  const modelRef = config ? getAgentDefaultModelRef(config) : undefined;
  if (modelRef) {
    return modelRef;
  }

  return '';
}

// Re-export ModelRegistry for advanced use cases
export { ModelRegistry, getModelRegistry, resetModelRegistry, prewarmModelRegistry } from './model-registry.js';
