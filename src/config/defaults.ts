import type { ModelDefinitionConfig, ModelProviderConfig } from './types.models.js';

// ============================================
// Default Model Aliases (Removed)
// ============================================
// Model aliases have been removed. Users must use full provider/model format
// (e.g., "anthropic/claude-sonnet-4-5").

// ============================================
// Default Values
// ============================================

const DEFAULT_MODEL_COST: ModelDefinitionConfig['cost'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

const DEFAULT_MODEL_INPUT: ModelDefinitionConfig['input'] = ["text"];
const DEFAULT_MODEL_MAX_TOKENS = 8192;
const DEFAULT_CONTEXT_TOKENS = 128000;

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

interface ApplyModelDefaultsOptions {
  warn?: (message: string) => void;
}

function _applyModelDefaults(
  cfg: { models?: { providers?: Record<string, ModelProviderConfig> } },
  _options: ApplyModelDefaultsOptions = {},
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

  if (!mutated) {
    return cfg;
  }

  return nextCfg;
}

// ============================================
// Resolve Model Alias (Removed)
// ============================================
// Model aliases have been removed. This function is kept as a no-op
// for any code that may still call it, but it just returns the input.

function _resolveModelAlias(alias: string): string | null {
  if (!alias || typeof alias !== 'string') {
    return null;
  }
  const trimmed = alias.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}
