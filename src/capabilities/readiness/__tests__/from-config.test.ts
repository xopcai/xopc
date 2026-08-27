import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import type { ModelCatalogSnapshot } from '../../../providers/model-catalog-store.js';
import { buildCapabilityPlansForConfig } from '../from-config.js';

function catalog(): ModelCatalogSnapshot {
  return {
    sources: {
      'xopc-cloud': {
        providerId: 'xopc-cloud', baseUrl: 'https://router.test/v1', api: 'openai-completions',
        etag: 'v2', recommendedModel: 'chat', recommended: { vision: 'vision' }, lastSuccessAt: Date.now(),
        models: [
          { id: 'a-vision-preview', name: 'Vision preview', availability: 'available', kind: 'language', input: ['text', 'image'], output: ['text'], operations: ['chat.completions'], reasoning: false, contextWindow: 128_000, maxOutputTokens: 8_192, stability: 'preview', priority: 1 },
          { id: 'vision', name: 'Vision', availability: 'available', kind: 'language', input: ['text', 'image'], output: ['text'], operations: ['chat.completions'], reasoning: false, contextWindow: 128_000, maxOutputTokens: 8_192 },
          { id: 'image', name: 'Image', availability: 'available', kind: 'image', input: ['text'], output: ['image'], operations: ['images.generate'], reasoning: false, contextWindow: 128_000, maxOutputTokens: null },
          { id: 'stt', name: 'STT', availability: 'available', kind: 'stt', input: ['audio'], output: ['text'], operations: ['audio.transcription'], reasoning: false, contextWindow: 128_000, maxOutputTokens: null },
          { id: 'tts', name: 'TTS', availability: 'available', kind: 'tts', input: ['text'], output: ['audio'], operations: ['audio.speech'], reasoning: false, contextWindow: 128_000, maxOutputTokens: null, tts: { maxCharacters: 1_000, languages: ['zh'], outputFormats: ['mp3'], streaming: false, speed: false, pitch: false, instructions: false, defaultVoice: 'coral' } },
        ],
      },
    },
  };
}

describe('buildCapabilityPlansForConfig', () => {
  it('makes every cloud capability ready without persisted modality config', () => {
    const config = ConfigSchema.parse({});
    const plans = buildCapabilityPlansForConfig(config, {
      catalog: catalog(), providerReady: (provider) => provider === 'xopc-cloud' || provider === 'edge',
      localSttReady: false,
    });

    expect(plans.vision.primary).toMatchObject({ provider: 'xopc-cloud', model: 'vision' });
    expect(plans['image-generation'].primary).toMatchObject({ provider: 'xopc-cloud', model: 'image' });
    expect(plans.stt.primary).toMatchObject({ provider: 'xopc-cloud', model: 'stt' });
    expect(plans.tts.primary).toMatchObject({ provider: 'xopc-cloud', model: 'tts', metadata: { defaultVoice: 'coral' } });
  });

  it('prefers an installed local STT model over cloud', () => {
    const plans = buildCapabilityPlansForConfig(ConfigSchema.parse({}), {
      catalog: catalog(), providerReady: () => true, localSttReady: true,
    });
    expect(plans.stt.primary).toMatchObject({ provider: 'xopc-local', source: 'installed-local' });
    expect(plans.stt.fallbacks[0]).toMatchObject({ provider: 'xopc-cloud' });
  });

  it('rejects cloud candidates when OAuth is not ready but retains Edge TTS', () => {
    const plans = buildCapabilityPlansForConfig(ConfigSchema.parse({}), {
      catalog: catalog(), providerReady: (provider) => provider === 'edge', localSttReady: false,
    });
    expect(plans.vision.status).toBe('unavailable');
    expect(plans.vision.rejected[0]?.reasons).toContain('oauth_not_connected');
    expect(plans.tts.primary).toMatchObject({ provider: 'edge', source: 'credentialless-fallback' });
  });
});
