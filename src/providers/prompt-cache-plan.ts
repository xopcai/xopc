import type { Api, Model } from '@earendil-works/pi-ai';

export interface PromptCachePolicy {
  mode: 'off' | 'auto';
  lifetime: 'short' | 'long';
}

export type PromptCacheProviderMode = 'none' | 'implicit' | 'explicit' | 'managed';

export interface PromptCachePlan {
  policy: PromptCachePolicy;
  providerMode: PromptCacheProviderMode;
  cacheKey?: string;
}

export const DEFAULT_PROMPT_CACHE_POLICY: PromptCachePolicy = {
  mode: 'auto',
  lifetime: 'short',
};

export function resolvePromptCachePolicy(policy?: Partial<PromptCachePolicy>): PromptCachePolicy {
  return {
    mode: policy?.mode ?? DEFAULT_PROMPT_CACHE_POLICY.mode,
    lifetime: policy?.lifetime ?? DEFAULT_PROMPT_CACHE_POLICY.lifetime,
  };
}

export function isOfficialOpenAIModel(model: Model<Api>): boolean {
  if (model.api === 'openai-codex-responses' || model.api === 'azure-openai-responses') return true;
  if (model.api !== 'openai-completions' && model.api !== 'openai-responses') return false;
  return model.provider === 'openai' || model.baseUrl?.includes('api.openai.com') === true;
}

function supportsExplicitOpenAICache(model: Model<Api>): boolean {
  return model.api === 'openai-responses'
    && isOfficialOpenAIModel(model)
    && /^gpt-5\.6(?:-|$)/.test(model.id);
}

export function resolvePromptCacheProviderMode(
  model: Model<Api>,
  policy: PromptCachePolicy,
): PromptCacheProviderMode {
  if (policy.mode === 'off') return 'none';
  if (supportsExplicitOpenAICache(model)) return 'explicit';
  if (isOfficialOpenAIModel(model)) return 'implicit';
  if (model.api === 'anthropic-messages' || model.api === 'bedrock-converse-stream') return 'explicit';
  if (model.api === 'google-generative-ai') return 'managed';
  return 'none';
}
