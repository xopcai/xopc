import {
  getModel as getPiAiModel,
  type Api,
  type Model,
} from '@earendil-works/pi-ai/compat';

const STALE_OPENAI_CONTEXT_WINDOW = 272_000;
const OPENAI_CONTEXT_WINDOW_CORRECTIONS = new Map<string, number>([
  ['gpt-5.4', 1_050_000],
  ['gpt-5.4-mini', 400_000],
  ['gpt-5.5', 1_050_000],
  ['gpt-5.6', 1_050_000],
  ['gpt-5.6-luna', 1_050_000],
  ['gpt-5.6-sol', 1_050_000],
  ['gpt-5.6-terra', 1_050_000],
]);

/** Correct narrowly scoped upstream catalog metadata while older pi-ai data is still installed. */
export function applyOfficialModelMetadataCorrections(model: Model<Api>): Model<Api> {
  const correctedContextWindow = OPENAI_CONTEXT_WINDOW_CORRECTIONS.get(model.id);
  if (
    (model.provider === 'openai' || model.provider === 'openai-codex')
    && correctedContextWindow !== undefined
    && model.contextWindow === STALE_OPENAI_CONTEXT_WINDOW
  ) {
    return { ...model, contextWindow: correctedContextWindow };
  }

  return model;
}

/**
 * Small local supplement for official model aliases that may lag in pi-ai.
 * Keep this list narrow: full provider catalogs should come from pi-ai.
 */
export function getSupplementalModels(): Model<Api>[] {
  const gpt56Sol = getPiAiModel('openai' as never, 'gpt-5.6-sol' as never) as Model<Api> | undefined;
  if (!gpt56Sol) return [];

  return [
    {
      ...gpt56Sol,
      id: 'gpt-5.6',
      name: 'GPT-5.6',
    },
  ];
}
