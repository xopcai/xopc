import { afterEach, describe, expect, it } from 'vitest';

import { isSTTAvailable } from '../availability.js';
import { getModelCatalogStore, resetModelCatalogStore } from '../../../providers/model-catalog-store.js';

afterEach(() => resetModelCatalogStore());

describe('isSTTAvailable', () => {
  it('allows runtime-configured OAuth providers without a stored config slice', () => {
    getModelCatalogStore().replaceSourceModels('xopc-cloud', {
      providerId: 'xopc-cloud', baseUrl: 'https://router.test/v1', api: 'openai-completions',
      etag: '1', recommendedModel: null, lastSuccessAt: Date.now(),
    }, [{
      id: 'stt', name: 'STT', kind: 'stt', input: ['audio'], output: ['text'],
      operations: ['audio.transcription'], reasoning: false, contextWindow: 128_000,
      maxOutputTokens: null,
    }]);
    expect(isSTTAvailable({
      enabled: true,
      provider: 'xopc-cloud',
      fallback: { enabled: false, order: [] },
    })).toBe(true);
  });

  it('still rejects credential providers without configuration', () => {
    expect(isSTTAvailable({
      enabled: true,
      provider: 'openai',
      fallback: { enabled: false, order: [] },
    })).toBe(false);
  });
});
