import type { Api, Model } from '@earendil-works/pi-ai';

/** Cloud presets, not a guarantee of account entitlement or free inference. */
export function getPhoneModels(): Model<Api>[] {
  const model = (provider: string, baseUrl: string, id: string, name: string, profile: string, contextWindow: number) => ({
    id, name, provider, baseUrl, api: 'openai-completions', reasoning: false, input: ['text', 'image'],
    contextWindow, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    phoneUse: { profile }, compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' },
  } as Model<Api>);
  return [
    model('dashscope-phone', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'gui-plus-2026-02-26', 'Bailian GUI-Plus · Phone', 'gui-owl-phone-v1', 262_144),
    model('volcengine-ark', 'https://ark.cn-beijing.volces.com/api/v3', 'doubao-seed-2-1-pro-260915', 'Doubao Seed 2.1 Pro · Phone', 'doubao-seed-phone-v1', 1_024_000),
  ];
}
