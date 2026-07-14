import {
  getModel as getPiAiModel,
  type Api,
  type Model,
} from '@earendil-works/pi-ai/compat';

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
