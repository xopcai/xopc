import type { ModelDefinitionConfig, ModelProviderConfig } from './types.models.js';

// ============================================
// Default Model Aliases
// ============================================

export const DEFAULT_MODEL_ALIASES: Readonly<Record<string, string>> = {
  // Anthropic (pi-ai catalog uses "latest" ids without date suffix)
  opus: "anthropic/claude-opus-4-6",
  sonnet: "anthropic/claude-sonnet-4-6",

  // OpenAI
  gpt: "openai/gpt-5.2",
  "gpt-mini": "openai/gpt-5-mini",

  // Google Gemini (3.x are preview ids in the catalog)
  gemini: "google/gemini-3-pro-preview",
  "gemini-flash": "google/gemini-3-flash-preview",

  // Common aliases for xopcbot
  "claude-opus": "anthropic/claude-opus-4-6",
  "claude-sonnet": "anthropic/claude-sonnet-4-6",
  "claude-haiku": "anthropic/claude-haiku-4",
};

// ============================================
// Default Values
// ============================================

export const DEFAULT_MODEL_COST: ModelDefinitionConfig['cost'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export const DEFAULT_MODEL_INPUT: ModelDefinitionConfig['input'] = ["text"];
export const DEFAULT_MODEL_MAX_TOKENS = 8192;
export const DEFAULT_CONTEXT_TOKENS = 128000;

// ============================================
// Helper Functions
// ============================================

type ModelDefinitionLike = Partial<ModelDefinitionConfig> &
  Pick<ModelDefinitionConfig, 'id' | 'name'>;

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function resolveModelCost(
  raw?: Partial<ModelDefinitionConfig['cost']>,
): ModelDefinitionConfig['cost'] {
  return {
    input: typeof raw?.input === 'number' ? raw.input : DEFAULT_MODEL_COST.input,
    output: typeof raw?.output === 'number' ? raw.output : DEFAULT_MODEL_COST.output,
    cacheRead: typeof raw?.cacheRead === 'number' ? raw.cacheRead : DEFAULT_MODEL_COST.cacheRead,
    cacheWrite:
      typeof raw?.cacheWrite === 'number' ? raw.cacheWrite : DEFAULT_MODEL_COST.cacheWrite,
  };
}

function resolveDefaultProviderApi(
  providerId: string,
  providerApi: ModelDefinitionConfig['api'] | undefined,
): ModelDefinitionConfig['api'] | undefined {
  if (providerApi) {
    return providerApi;
  }
  // Default API based on provider
  const providerLower = providerId.toLowerCase();
  if (providerLower === 'anthropic') return 'anthropic-messages';
  if (providerLower === 'openai') return 'openai-responses';
  if (providerLower === 'google') return 'google-generative-ai';
  if (providerLower === 'github-copilot') return 'github-copilot';
  if (providerLower === 'ollama') return 'ollama';
  if (providerLower === 'bedrock') return 'bedrock-converse-stream';
  return undefined;
}

// ============================================
// Apply Model Defaults
// ============================================

export interface ApplyModelDefaultsOptions {
  warn?: (message: string) => void;
}

export function applyModelDefaults(
  cfg: { models?: { providers?: Record<string, ModelProviderConfig> } },
  options: ApplyModelDefaultsOptions = {},
): { models?: { providers?: Record<string, ModelProviderConfig> } } {
  let mutated = false;
  let nextCfg = { ...cfg };

  const providerConfig = nextCfg.models?.providers;
  if (providerConfig) {
    const nextProviders = { ...providerConfig };
    for (const [providerId, provider] of Object.entries(providerConfig)) {
      const models = provider.models;
      if (!Array.isArray(models) || models.length === 0) {
        continue;
      }
      const providerApi = resolveDefaultProviderApi(providerId, provider.api);
      let nextProvider = provider;
      if (providerApi && provider.api !== providerApi) {
        mutated = true;
        nextProvider = { ...nextProvider, api: providerApi };
      }
      let providerMutated = false;
      const nextModels = models.map((model) => {
        const raw = model as ModelDefinitionLike;
        let modelMutated = false;

        const reasoning = typeof raw.reasoning === 'boolean' ? raw.reasoning : false;
        if (raw.reasoning !== reasoning) {
          modelMutated = true;
        }

        const input = raw.input ?? [...DEFAULT_MODEL_INPUT];
        if (raw.input === undefined) {
          modelMutated = true;
        }

        const cost = resolveModelCost(raw.cost);
        const costMutated =
          !raw.cost ||
          raw.cost.input !== cost.input ||
          raw.cost.output !== cost.output ||
          raw.cost.cacheRead !== cost.cacheRead ||
          raw.cost.cacheWrite !== cost.cacheWrite;
        if (costMutated) {
          modelMutated = true;
        }

        const contextWindow = isPositiveNumber(raw.contextWindow)
          ? raw.contextWindow
          : DEFAULT_CONTEXT_TOKENS;
        if (raw.contextWindow !== contextWindow) {
          modelMutated = true;
        }

        const defaultMaxTokens = Math.min(DEFAULT_MODEL_MAX_TOKENS, contextWindow);
        const rawMaxTokens = isPositiveNumber(raw.maxTokens) ? raw.maxTokens : defaultMaxTokens;
        const maxTokens = Math.min(rawMaxTokens, contextWindow);
        if (raw.maxTokens !== maxTokens) {
          modelMutated = true;
        }
        const api = raw.api ?? providerApi;
        if (raw.api !== api) {
          modelMutated = true;
        }

        if (!modelMutated) {
          return model;
        }
        providerMutated = true;
        return {
          ...raw,
          reasoning,
          input,
          cost,
          contextWindow,
          maxTokens,
          api,
        } as ModelDefinitionConfig;
      });

      if (!providerMutated) {
        if (nextProvider !== provider) {
          nextProviders[providerId] = nextProvider;
        }
        continue;
      }
      nextProviders[providerId] = { ...nextProvider, models: nextModels };
      mutated = true;
    }

    if (mutated) {
      nextCfg = {
        ...nextCfg,
        models: {
          ...nextCfg.models,
          providers: nextProviders,
        },
      };
    }
  }

  // Apply model aliases
  const existingModels = {}; // TODO: Apply from agent defaults if needed

  if (!mutated) {
    return cfg;
  }

  return nextCfg;
}

// ============================================
// Resolve Model Alias
// ============================================

export function resolveModelAlias(alias: string): string | null {
  if (!alias || typeof alias !== 'string') {
    return null;
  }
  const trimmed = alias.trim();
  if (!trimmed) {
    return null;
  }
  const aliasKey = trimmed.toLowerCase();
  return DEFAULT_MODEL_ALIASES[aliasKey] ?? trimmed;
}
