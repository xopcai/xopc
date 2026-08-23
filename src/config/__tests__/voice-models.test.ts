import { afterEach, describe, expect, it } from 'vitest';

import { getModelCatalogStore, resetModelCatalogStore } from '../../providers/model-catalog-store.js';
import { getVoiceModelsConfig } from '../voice.js';

afterEach(() => resetModelCatalogStore());

describe('getVoiceModelsConfig', () => {
  it('exposes available XOPC Cloud voice models from the runtime catalog', () => {
    getModelCatalogStore().saveSource('xopc-cloud', {
      providerId: 'xopc-cloud',
      baseUrl: 'https://console.xopc.ai/api/v1',
      api: 'openai-completions',
      etag: null,
      recommendedModel: null,
      lastSuccessAt: 1,
      models: [
        {
          id: 'cloud-stt', name: 'Cloud STT', availability: 'available', kind: 'stt',
          input: ['audio'], output: ['text'], operations: ['audio.transcription'],
          reasoning: false, contextWindow: 0, maxOutputTokens: null,
        },
        {
          id: 'removed-stt', name: 'Removed STT', availability: 'unavailable', kind: 'stt',
          input: ['audio'], output: ['text'], operations: ['audio.transcription'],
          reasoning: false, contextWindow: 0, maxOutputTokens: null,
        },
      ],
    });

    expect(getVoiceModelsConfig().stt['xopc-cloud']).toEqual([
      { id: 'cloud-stt', name: 'Cloud STT' },
    ]);
  });
});
