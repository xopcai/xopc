import type { Api, Model } from '@earendil-works/pi-ai';
import type { ComputerProfile } from '@xopcai/computer-control-contract';

const OPENAI_COMPUTER_MODELS = new Set([
  'gpt-6-astra',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
]);

type ComputerCapableModel = Model<Api> & { computerUse?: { profile: ComputerProfile } };

/** Attach xopc's Computer Use contract to supported OpenAI Responses models. */
export function applyOfficialModelMetadataCorrections(model: Model<Api>): Model<Api> {
  if (model.provider !== 'openai' || model.api !== 'openai-responses' || !OPENAI_COMPUTER_MODELS.has(model.id)) {
    return model;
  }
  return { ...model, computerUse: { profile: 'openai-responses-computer-v1' } } as ComputerCapableModel;
}

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
