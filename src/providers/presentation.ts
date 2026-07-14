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
import {
  getDomesticProviderPreset,
  getDomesticProviderPresetIds,
  type DomesticProviderModelPreset,
} from './domestic-presets.js';
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

const FEATURED_PROVIDER_ORDER = [
  'openai',
  'anthropic',
  'xai',
  'google',
  'openrouter',
  'dashscope-cn',
  'dashscope-intl',
  'volcengine-ark',
  'volcengine-plan',
  'byteplus-plan',
  'deepseek',
  'moonshotai',
  'moonshotai-cn',
  'kimi-coding',
  'stepfun-cn',
  'stepfun-intl',
  'stepfun-plan-cn',
  'stepfun-plan-intl',
  'xiaomi',
  'xiaomi-token-plan-cn',
  'ant-ling',
  'zhipu-cn',
  'zai',
  'zai-coding-cn',
  'zhipu-coding-cn',
  'minimax',
  'minimax-cn',
];

const PROVIDER_HINTS: Record<string, string> = {
  openai: 'Frontier OpenAI models from the official API.',
  anthropic: 'Claude models for coding, long context, and reasoning.',
  xai: 'Grok models from xAI.',
  google: 'Gemini models with strong multimodal and long-context support.',
  openrouter: 'Route many hosted models through one API key.',
  dashscope: 'DashScope service provider for Alibaba Model Studio.',
  'dashscope-cn': 'Alibaba Bailian Qwen models through the China OpenAI-compatible endpoint.',
  'dashscope-intl': 'Alibaba Bailian Qwen models through the international OpenAI-compatible endpoint.',
  'volcengine-ark': 'Volcengine Ark OpenAI-compatible endpoints; use your Ark endpoint id as the model id.',
  'volcengine-plan': 'Doubao coding-plan models through Volcengine Ark.',
  'byteplus-plan': 'Doubao coding-plan models through BytePlus.',
  deepseek: 'DeepSeek V4 models with strong price/performance.',
  moonshotai: 'Kimi models through Moonshot International.',
  'moonshotai-cn': 'Kimi models through Moonshot China.',
  'kimi-coding': 'Kimi dedicated coding endpoint with Anthropic-compatible requests.',
  stepfun: 'StepFun OpenAI-compatible endpoint.',
  'stepfun-cn': 'StepFun China OpenAI-compatible endpoint.',
  'stepfun-intl': 'StepFun international OpenAI-compatible endpoint.',
  'stepfun-plan': 'StepFun Step Plan coding/planning endpoint.',
  'stepfun-plan-cn': 'StepFun Step Plan China coding/planning endpoint.',
  'stepfun-plan-intl': 'StepFun Step Plan international coding/planning endpoint.',
  xiaomi: 'Xiaomi MiMo OpenAI-compatible model access.',
  'xiaomi-token-plan-cn': 'Xiaomi MiMo Token Plan China endpoint.',
  'xiaomi-token-plan-ams': 'Xiaomi MiMo Token Plan Amsterdam endpoint.',
  'xiaomi-token-plan-sgp': 'Xiaomi MiMo Token Plan Singapore endpoint.',
  'ant-ling': 'Ant Ling models through a domestic OpenAI-compatible endpoint.',
  'zhipu-cn': 'Zhipu GLM China through the BigModel OpenAI-compatible API.',
  zai: 'Zhipu GLM International through z.ai.',
  'zai-coding-cn': 'Zhipu GLM coding-plan China endpoint from pi-ai.',
  'zai-coding-global': 'Zhipu GLM coding-plan international endpoint.',
  'zhipu-coding-cn': 'Zhipu GLM coding-plan China endpoint.',
  minimax: 'MiniMax text models; Anthropic-compatible endpoint is preferred for agent workflows.',
  'minimax-cn': 'MiniMax China endpoint for domestic access.',
  'openai-codex': 'OpenAI Codex models through OAuth.',
  'google-gemini-cli': 'Gemini through Google Cloud Code Assist OAuth.',
  'google-antigravity': 'Gemini/Antigravity OAuth model access.',
};

const RECOMMENDED_MODEL_PATTERNS: Record<string, RegExp[]> = {
  openai: [/^gpt-5\.6$/i, /^gpt-5\.6-sol$/i, /^gpt-5\.6-terra$/i, /^gpt-5\.6-luna$/i, /^gpt-5\.5$/i, /^gpt-5\.5-pro$/i],
  'openai-codex': [/^gpt-5\.6-sol$/i, /^gpt-5\.6-terra$/i, /^gpt-5\.6-luna$/i, /^gpt-5\.5$/i],
  anthropic: [/^claude-sonnet-5$/i, /^claude-opus-4-8$/i, /^claude-fable-5$/i, /^claude-sonnet-4-6$/i, /^claude-sonnet-4-5$/i],
  google: [/^gemini-3\.5-flash$/i, /^gemini-3\.1-pro-preview$/i, /^gemini-3-flash-preview$/i, /^gemini-3-pro-preview$/i],
  'google-vertex': [/^gemini-3\.5-flash$/i, /^gemini-3\.1-pro-preview$/i, /^gemini-3-flash-preview$/i, /^gemini-3-pro-preview$/i],
  xai: [/^grok-4/i, /^grok-3/i, /^grok-code/i],
  dashscope: [/^qwen3\.7-plus$/i, /^qwen3\.7-max$/i, /^qwen3\.6-flash$/i],
  'dashscope-cn': [/^qwen3\.7-plus$/i, /^qwen3\.7-max$/i, /^qwen3\.6-flash$/i],
  'dashscope-intl': [/^qwen3\.7-plus$/i, /^qwen3\.7-max$/i, /^qwen3\.6-flash$/i],
  'volcengine-ark': [/^ep-your-endpoint-id$/i],
  'volcengine-plan': [/^ark-code-latest$/i, /^doubao-seed-2\.0-code$/i, /^doubao-seed-2\.0-pro$/i],
  'byteplus-plan': [/^ark-code-latest$/i, /^doubao-seed-2\.0-code$/i, /^doubao-seed-2\.0-pro$/i],
  deepseek: [/^deepseek-v4-flash$/i, /^deepseek-v4-pro$/i],
  openrouter: [/^openai\/gpt-5/i, /^anthropic\/claude-sonnet-4/i, /^google\/gemini-3/i],
  moonshotai: [/^kimi-k2\.7-code$/i, /^kimi-k2\.6$/i],
  'moonshotai-cn': [/^kimi-k2\.7-code$/i, /^kimi-k2\.6$/i],
  'kimi-coding': [/^kimi-k2\.7-code$/i],
  stepfun: [/^step-3\.7-flash$/i, /^step-3\.5-flash-2603$/i, /^step-3\.5-flash$/i],
  'stepfun-cn': [/^step-3\.7-flash$/i, /^step-3\.5-flash-2603$/i, /^step-3\.5-flash$/i],
  'stepfun-intl': [/^step-3\.7-flash$/i, /^step-3\.5-flash-2603$/i, /^step-3\.5-flash$/i],
  'stepfun-plan': [/^step-3\.7-flash$/i, /^step-3\.5-flash-2603$/i, /^step-3\.5-flash$/i],
  'stepfun-plan-cn': [/^step-3\.7-flash$/i, /^step-3\.5-flash-2603$/i, /^step-3\.5-flash$/i],
  'stepfun-plan-intl': [/^step-3\.7-flash$/i, /^step-3\.5-flash-2603$/i, /^step-3\.5-flash$/i],
  xiaomi: [/^mimo-v2\.5-pro$/i, /^mimo-v2\.5-pro-ultraspeed$/i, /^mimo-v2\.5$/i],
  'xiaomi-token-plan-cn': [/^mimo-v2\.5-pro$/i, /^mimo-v2\.5-pro-ultraspeed$/i, /^mimo-v2\.5$/i],
  'xiaomi-token-plan-ams': [/^mimo-v2\.5-pro$/i, /^mimo-v2\.5-pro-ultraspeed$/i, /^mimo-v2\.5$/i],
  'xiaomi-token-plan-sgp': [/^mimo-v2\.5-pro$/i, /^mimo-v2\.5-pro-ultraspeed$/i, /^mimo-v2\.5$/i],
  'ant-ling': [/^Ling-2\.6-1T$/i, /^Ling-2\.6-flash$/i, /^Ring-2\.6-1T$/i],
  'zhipu-cn': [/^glm-5\.2$/i],
  zai: [/^glm-5\.2$/i],
  'zai-coding-cn': [/^glm-5\.2$/i, /^glm-5\.1$/i, /^glm-5-turbo$/i],
  'zai-coding-global': [/^glm-5\.2$/i],
  'zhipu-coding-cn': [/^glm-5\.2$/i],
  minimax: [/^MiniMax-M3$/i, /^MiniMax-M2\.7-highspeed$/i, /^MiniMax-M2\.7$/i],
  'minimax-cn': [/^MiniMax-M3$/i, /^MiniMax-M2\.7-highspeed$/i, /^MiniMax-M2\.7$/i],
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

function presetModelToCatalogView(provider: string, model: DomesticProviderModelPreset): ModelCatalogView {
  const input = model.input ?? ['text'];
  return {
    ref: `${provider}/${model.id}`,
    provider,
    id: model.id,
    name: model.name || model.id,
    reasoning: model.reasoning ?? false,
    input,
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
    vision: input.includes('image'),
    recommended: isRecommendedModel(provider, model.id),
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
  const fromRegistry = models
    .filter((model) => isRecommendedModel(provider, model.id))
    .slice(0, limit)
    .map(modelToCatalogView);
  if (fromRegistry.length > 0) return fromRegistry;

  const preset = getDomesticProviderPreset(provider);
  if (!preset) return [];
  return preset.models
    .filter((model) => isRecommendedModel(provider, model.id))
    .slice(0, limit)
    .map((model) => presetModelToCatalogView(provider, model));
}

export function getProviderHint(provider: string): string | undefined {
  return PROVIDER_HINTS[provider];
}

export function getOnboardingFeaturedProviders(): string[] {
  const providers = new Set([...getAllProviders(), ...getDomesticProviderPresetIds()]);
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
    const catOrder: Record<ProviderCategory, number> = {
      common: 0,
      domestic: 1,
      specialty: 2,
      enterprise: 3,
      oauth: 4,
      extension: 5,
    };
    if (catOrder[catA] !== catOrder[catB]) return catOrder[catA] - catOrder[catB];
    return getProviderDisplayName(a).localeCompare(getProviderDisplayName(b), undefined, { sensitivity: 'base' });
  });
}

export async function getProviderCatalogViews(): Promise<ProviderCatalogView[]> {
  const pluginRegistry = getProviderRegistry();
  const providers = sortProvidersForPicker([...new Set([...getAllProviders(), ...getDomesticProviderPresetIds()])]);
  const modelCounts = new Map<string, number>();
  for (const model of getAllModels()) {
    modelCounts.set(model.provider, (modelCounts.get(model.provider) ?? 0) + 1);
  }

  return Promise.all(
    providers.map(async (provider) => {
      const plugin = pluginRegistry.get(provider);
      const meta = PROVIDER_META[provider];
      const domesticPreset = getDomesticProviderPreset(provider);
      return {
        id: provider,
        name: plugin?.name ?? domesticPreset?.displayName ?? getProviderDisplayName(provider),
        category: plugin ? 'extension' : (meta?.category ?? (domesticPreset ? 'domestic' : 'specialty')),
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
