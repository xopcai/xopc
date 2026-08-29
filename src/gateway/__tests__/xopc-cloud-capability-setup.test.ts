import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import type { CatalogModel, CatalogSource } from '../../providers/model-catalog-store.js';
import {
  prepareXopcCloudCapabilitySetup,
  selectXopcCloudCapabilities,
} from '../xopc-cloud-capability-setup.js';

function model(input: Partial<CatalogModel> & Pick<CatalogModel, 'id' | 'kind'>): CatalogModel {
  return {
    name: input.id,
    availability: 'available',
    input: ['text'],
    output: ['text'],
    operations: ['chat.completions'],
    reasoning: false,
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
    ...input,
  };
}

function source(models: CatalogModel[]): CatalogSource {
  return {
    providerId: 'xopc-cloud',
    baseUrl: 'https://cloud.test/v1',
    api: 'openai-completions',
    etag: 'catalog-v1',
    recommendedModel: 'chat',
    recommended: {
      vision: 'vision-recommended',
      'image-generation': 'image-recommended',
      stt: 'stt-recommended',
      tts: 'tts-recommended',
    },
    lastSuccessAt: Date.now(),
    models,
  };
}

const completeCatalog = source([
  model({ id: 'vision-other', kind: 'language', input: ['text', 'image'], priority: 0 }),
  model({ id: 'vision-recommended', kind: 'language', input: ['text', 'image'], priority: 10 }),
  model({ id: 'image-recommended', kind: 'image', output: ['image'], operations: ['images.generate'] }),
  model({ id: 'stt-recommended', kind: 'stt', input: ['audio'], operations: ['audio.transcription'] }),
  model({
    id: 'tts-recommended',
    kind: 'tts',
    output: ['audio'],
    operations: ['audio.speech'],
    tts: {
      maxCharacters: 600,
      languages: ['zh', 'en'],
      outputFormats: ['wav'],
      streaming: false,
      speed: false,
      pitch: false,
      instructions: false,
      defaultVoice: 'Chelsie',
    },
  }),
]);

describe('XOPC Cloud capability setup', () => {
  it('selects the Cloud recommendation for all four capabilities', () => {
    expect(selectXopcCloudCapabilities(completeCatalog)).toEqual({
      missing: [],
      selection: {
        vision: 'vision-recommended',
        imageGeneration: 'image-recommended',
        stt: 'stt-recommended',
        tts: 'tts-recommended',
        ttsVoice: 'Chelsie',
      },
    });
  });

  it('writes STT, TTS, image understanding, and image generation in one config', () => {
    const config = ConfigSchema.parse({
      agents: {
        capabilityPresets: {
          default: {
            id: 'default',
            name: 'Global defaults',
            version: 1,
            models: {
              defaultRole: 'deep',
              roles: { deep: { model: 'xopc-cloud/chat' } },
            },
          },
        },
      },
      tools: {
        media: {
          audio: {
            enabled: true,
            provider: 'xopc-local',
            providers: { 'xopc-local': { model: 'sensevoice-small' } },
          },
        },
      },
    });

    const prepared = prepareXopcCloudCapabilitySetup(config, completeCatalog);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const preset = prepared.config.agents.capabilityPresets[prepared.config.agents.defaultPreset];
    expect(preset.models).toMatchObject({
      roles: { deep: { model: 'xopc-cloud/chat' } },
      imageModel: { primary: 'xopc-cloud/vision-recommended' },
      imageGenerationModel: { primary: 'xopc-cloud/image-recommended' },
    });
    expect(prepared.config.tools.media?.audio).toMatchObject({
      enabled: true,
      provider: 'xopc-cloud',
      fallback: { enabled: false, order: ['xopc-cloud'] },
      providers: {
        'xopc-local': { model: 'sensevoice-small' },
        'xopc-cloud': { model: 'stt-recommended' },
      },
    });
    expect(prepared.config.messages?.tts).toMatchObject({
      enabled: true,
      provider: 'xopc-cloud',
      trigger: 'off',
      providers: {
        'xopc-cloud': { model: 'tts-recommended', voice: 'Chelsie' },
      },
    });
  });

  it('does not produce a partial configuration when the catalog is incomplete', () => {
    const incomplete = source(completeCatalog.models.filter((entry) => entry.kind !== 'image'));
    const prepared = prepareXopcCloudCapabilitySetup(ConfigSchema.parse({}), incomplete);

    expect(prepared).toMatchObject({ ok: false, missing: ['image-generation'] });
  });
});
