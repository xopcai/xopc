import type { Api, Model } from '@earendil-works/pi-ai';

/**
 * Local catalog entries required by xopc's Computer Use providers.
 * Keep this list narrow: full provider catalogs should come from pi-ai.
 */
export function getSupplementalModels(): Model<Api>[] {
  return [
    {
      id: 'gui-plus-2026-02-26', name: 'GUI-Plus (2026-02-26)', provider: 'dashscope-cn',
      api: 'openai-completions', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      reasoning: true, input: ['text', 'image'], contextWindow: 262_144, maxTokens: 32_768,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      computerUse: { profile: 'gui-plus-2026-02-26' },
    } as Model<Api>,
  ];
}
