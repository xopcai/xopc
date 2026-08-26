import { beforeEach, describe, expect, it } from 'vitest';

import type { Api, Model } from '@earendil-works/pi-ai';

import { PROMPT_CACHE_BOUNDARY } from '../../agent/prompt/cache-boundary.js';
import {
  buildPromptCacheSnapshot,
  clearPromptCacheObservations,
  diffPromptCacheSnapshots,
  observePromptCacheSnapshot,
} from '../prompt-cache-observability.js';

function model(id = 'gpt-test'): Model<Api> {
  return { provider: 'openai', id, api: 'openai-responses' } as Model<Api>;
}

describe('prompt cache observability', () => {
  beforeEach(clearPromptCacheObservations);

  it('separates stable and dynamic prompt changes', () => {
    const first = buildPromptCacheSnapshot({
      model: model(),
      systemPrompt: `stable${PROMPT_CACHE_BOUNDARY}turn one`,
      tools: [{ name: 'read', parameters: { type: 'object' } }],
      reasoning: 'medium',
    });
    const second = buildPromptCacheSnapshot({
      model: model(),
      systemPrompt: `stable${PROMPT_CACHE_BOUNDARY}turn two`,
      tools: [{ name: 'read', parameters: { type: 'object' } }],
      reasoning: 'medium',
    });

    expect(diffPromptCacheSnapshots(first, second)).toEqual(['dynamic_context_changed']);
  });

  it('reports stable system, model, reasoning, and tool changes', () => {
    const first = buildPromptCacheSnapshot({ model: model(), systemPrompt: 'one', tools: [], reasoning: 'low' });
    const second = buildPromptCacheSnapshot({
      model: model('gpt-next'),
      systemPrompt: 'two',
      tools: [{ name: 'read' }],
      reasoning: 'high',
    });

    expect(diffPromptCacheSnapshots(first, second)).toEqual([
      'model_changed',
      'reasoning_changed',
      'system_changed',
      'tools_changed',
    ]);
  });

  it('tracks the previous snapshot by scope', () => {
    const snapshot = buildPromptCacheSnapshot({ model: model(), systemPrompt: 'stable' });
    expect(observePromptCacheSnapshot('session', snapshot)).toEqual([]);
    expect(observePromptCacheSnapshot('session', snapshot)).toEqual([]);
  });
});
