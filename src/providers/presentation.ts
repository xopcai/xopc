import type { Api, Model } from '@earendil-works/pi-ai';

import {
  getAllModels,
  getAllProviders,
  getModelsByProvider,
  getProviderDisplayName,
  isProviderConfigured,
  PROVIDER_META,
  type ProviderCategory,
} from './index.js';
import { getProviderRegistry } from './plugin-registry.js';

export interface ModelCatalogView {
  ref: string;
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  contextWindow?: number;
  maxTokens?: number;
  vision: boolean;
  recommended: boolean;
}

export interface ProviderCatalogView {
  id: string;
  name: string;
  category: ProviderCategory;
  supportsOAuth: boolean;
  supportsApiKey: boolean;
  configured: boolean;
  onboardingFeatured: boolean;
  recommendedModels: ModelCatalogView[];
  modelCount: number;
  hint?: string;
}

const FEATURED_PROVIDER_ORDER = ['openai', 'anthropic', 'xai', 'google', 'openrouter', 'deepseek'];

const PROVIDER_HINTS: Record<string, string> = {
  openai: 'Frontier OpenAI models from the official API.',
  anthropic: 'Claude models for coding, long context, and reasoning.',
  xai: 'Grok models from xAI.',
  google: 'Gemini models with strong multimodal and long-context support.',
  openrouter: 'Route many hosted models through one API key.',
  deepseek: 'DeepSeek V4 models with strong price/performance.',
  'openai-codex': 'OpenAI Codex models through OAuth.',
  'google-gemini-cli': 'Gemini through Google Cloud Code Assist OAuth.',
  'google-antigravity': 'Gemini/Antigravity OAuth model access.',
};

const RECOMMENDED_MODEL_PATTERNS: Record<string, RegExp[]> = {
  openai: [/^gpt-5\.5$/i, /^gpt-5\.4$/i, /^gpt-5\.4-mini$/i, /^gpt-5\.4-pro$/i],
  'openai-codex': [/^gpt-5\.5$/i, /^gpt-5\.4$/i, /^gpt-5\.4-mini$/i],
  anthropic: [/^claude-sonnet-4/i, /^claude-opus-4/i, /^claude-haiku-4/i],
  google: [/^gemini-3/i, /^gemini-2\.5-pro$/i, /^gemini-2\.5-flash$/i],
  'google-vertex': [/^gemini-3/i, /^gemini-2\.5-pro$/i, /^gemini-2\.5-flash$/i],
  xai: [/^grok-4/i, /^grok-3/i, /^grok-code/i],
  deepseek: [/^deepseek-v4-flash$/i, /^deepseek-v4-pro$/i],
  openrouter: [/^openai\/gpt-5/i, /^anthropic\/claude-sonnet-4/i, /^google\/gemini-3/i],
  moonshotai: [/^kimi-k2\.6$/i, /^kimi-k2\.5$/i, /^kimi-k2-thinking/i],
  'moonshotai-cn': [/^kimi-k2\.6$/i, /^kimi-k2\.5$/i, /^kimi-k2-thinking/i],
};

function modelRef(model: Pick<Model<Api>, 'provider' | 'id'>): string {
  return `${model.provider}/${model.id}`;
}

function recommendedRank(provider: string, modelId: string): number {
  const patterns = RECOMMENDED_MODEL_PATTERNS[provider] ?? [];
  const idx = patterns.findIndex((pattern) => pattern.test(modelId));
  return idx === -1 ? Number.POSITIVE_INFINITY : idx;
}

export function isRecommendedModel(provider: string, modelId: string): boolean {
  return Number.isFinite(recommendedRank(provider, modelId));
}

export function modelToCatalogView(model: Model<Api>): ModelCatalogView {
  const input = (model.input ?? ['text']) as Array<'text' | 'image'>;
  return {
    ref: modelRef(model),
    provider: model.provider,
    id: model.id,
    name: model.name || model.id,
    reasoning: model.reasoning ?? false,
    input,
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
    vision: input.includes('image'),
    recommended: isRecommendedModel(model.provider, model.id),
  };
}

export function sortModelsForPicker(models: readonly Model<Api>[]): Model<Api>[] {
  return [...models].sort((a, b) => {
    const aRank = recommendedRank(a.provider, a.id);
    const bRank = recommendedRank(b.provider, b.id);
    if (aRank !== bRank) return aRank - bRank;
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' });
  });
}

export function getRecommendedModelsForProvider(provider: string, limit = 4): ModelCatalogView[] {
  const models = sortModelsForPicker(getModelsByProvider(provider));
  return models
    .filter((model) => isRecommendedModel(provider, model.id))
    .slice(0, limit)
    .map(modelToCatalogView);
}

export function getProviderHint(provider: string): string | undefined {
  return PROVIDER_HINTS[provider];
}

export function getOnboardingFeaturedProviders(): string[] {
  const providers = new Set(getAllProviders());
  return FEATURED_PROVIDER_ORDER.filter((provider) => providers.has(provider));
}

export function sortProvidersForPicker(providers: readonly string[]): string[] {
  const featuredRank = new Map(FEATURED_PROVIDER_ORDER.map((provider, index) => [provider, index] as const));
  return [...providers].sort((a, b) => {
    const aRank = featuredRank.get(a) ?? Number.POSITIVE_INFINITY;
    const bRank = featuredRank.get(b) ?? Number.POSITIVE_INFINITY;
    if (aRank !== bRank) return aRank - bRank;
    const catA = PROVIDER_META[a]?.category ?? 'specialty';
    const catB = PROVIDER_META[b]?.category ?? 'specialty';
    const catOrder: Record<ProviderCategory, number> = { common: 0, specialty: 1, enterprise: 2, oauth: 3, extension: 4 };
    if (catOrder[catA] !== catOrder[catB]) return catOrder[catA] - catOrder[catB];
    return getProviderDisplayName(a).localeCompare(getProviderDisplayName(b), undefined, { sensitivity: 'base' });
  });
}

export async function getProviderCatalogViews(): Promise<ProviderCatalogView[]> {
  const pluginRegistry = getProviderRegistry();
  const providers = sortProvidersForPicker(getAllProviders());
  const modelCounts = new Map<string, number>();
  for (const model of getAllModels()) {
    modelCounts.set(model.provider, (modelCounts.get(model.provider) ?? 0) + 1);
  }

  return Promise.all(
    providers.map(async (provider) => {
      const plugin = pluginRegistry.get(provider);
      const meta = PROVIDER_META[provider];
      return {
        id: provider,
        name: plugin?.name ?? getProviderDisplayName(provider),
        category: plugin ? 'extension' : (meta?.category ?? 'specialty'),
        supportsOAuth: plugin ? false : (meta?.supportsOAuth ?? false),
        supportsApiKey: plugin ? false : (meta?.supportsApiKey ?? true),
        configured: plugin ? true : await isProviderConfigured(provider),
        onboardingFeatured: FEATURED_PROVIDER_ORDER.includes(provider),
        recommendedModels: getRecommendedModelsForProvider(provider),
        modelCount: modelCounts.get(provider) ?? 0,
        ...(getProviderHint(provider) ? { hint: getProviderHint(provider) } : {}),
      };
    }),
  );
}
