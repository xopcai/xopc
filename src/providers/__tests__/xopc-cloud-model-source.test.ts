import { describe, expect, it, vi } from 'vitest';

import { ModelCatalogStore } from '../model-catalog-store.js';
import { XopcCloudModelError, XopcCloudModelSource } from '../xopc-cloud-model-source.js';

describe('XopcCloudModelSource', () => {
  it('skips discovery when OAuth is not configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const source = new XopcCloudModelSource({
      fetchImpl,
      credentials: { resolveApiKey: async () => null },
    });

    await expect(source.refresh()).resolves.toEqual({
      status: 'skipped',
      reason: 'not_configured',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('atomically replaces the in-memory model snapshot using OAuth bearer auth', async () => {
    const store = new ModelCatalogStore();
    const refreshModels = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer oauth-access');
      return Response.json({
        object: 'list',
        data: [
          {
            id: 'model-b',
            xopc: {
              kind: 'image',
              operations: ['images.generate'],
              capabilities: {
                input: ['text'], output: ['image'], reasoning: false,
                imageGeneration: {
                  maxCount: 2, sizes: ['1024x1024'], qualities: ['high'],
                  formats: ['png'], backgrounds: [], maxInputImages: 0,
                },
              },
            },
          },
          { id: 'model-a' },
          {
            id: 'stt-a', xopc: { kind: 'stt', capabilities: {
              inputFormats: ['wav', 'opus'], maxBytes: 1000, maxDurationSeconds: 60,
              languages: ['zh'], languageHint: true, prompt: true, timestamps: ['segment'], diarization: false,
            } },
          },
          {
            id: 'tts-a', xopc: { kind: 'tts', defaultVoice: 'coral', capabilities: {
              maxCharacters: 1000, languages: ['zh'], outputFormats: ['mp3', 'opus'],
              streaming: true, speed: true, pitch: false, instructions: true,
            } },
          },
          { id: 'model-a' },
          { id: '' },
        ],
      }, { headers: { 'x-xopc-model-catalog-version': 'catalog-2' } });
    });
    const source = new XopcCloudModelSource({
      fetchImpl,
      routerUrl: 'https://router.test/v1/',
      credentials: { resolveApiKey: async () => 'oauth-access' },
      catalogStore: store,
      refreshModels,
    });

    await expect(source.refresh()).resolves.toEqual({
      status: 'updated',
      modelCount: 4,
      models: ['model-b', 'model-a', 'stt-a', 'tts-a'],
    });
    expect(store.getSource('xopc-cloud')).toMatchObject({
      providerId: 'xopc-cloud',
      baseUrl: 'https://router.test/v1',
      etag: 'catalog-2',
      models: [
        {
          id: 'model-b', availability: 'available', kind: 'image', input: ['text'],
          output: ['image'], operations: ['images.generate'], reasoning: false,
          maxOutputTokens: null,
          imageGeneration: expect.objectContaining({ maxCount: 2, sizes: ['1024x1024'] }),
        },
        {
          id: 'model-a', availability: 'available', kind: 'language', input: ['text'],
          output: ['text'], operations: ['chat.completions', 'responses'],
          reasoning: false, maxOutputTokens: null,
        },
        expect.objectContaining({
          id: 'stt-a', kind: 'stt', input: ['audio'], output: ['text'], operations: ['audio.transcription'],
          stt: expect.objectContaining({ inputFormats: ['wav', 'opus'], maxDurationSeconds: 60 }),
        }),
        expect.objectContaining({
          id: 'tts-a', kind: 'tts', input: ['text'], output: ['audio'], operations: ['audio.speech'],
          tts: expect.objectContaining({ defaultVoice: 'coral', outputFormats: ['mp3', 'opus'] }),
        }),
      ],
    });
    expect(refreshModels).toHaveBeenCalledOnce();
  });

  it('preserves structured model service failures', async () => {
    const source = new XopcCloudModelSource({
      fetchImpl: async () => Response.json({
        error: { message: 'OAuth grant revoked', code: 'invalid_token' },
      }, { status: 401 }),
      credentials: { resolveApiKey: async () => 'expired-token' },
    });

    await expect(source.refresh()).rejects.toMatchObject<XopcCloudModelError>({
      name: 'XopcCloudModelError',
      status: 401,
      code: 'invalid_token',
      message: 'OAuth grant revoked',
    });
  });

  it('preserves the last usable snapshot when a successful response is malformed', async () => {
    const store = new ModelCatalogStore();
    store.replaceSourceModels('xopc-cloud', {
      providerId: 'xopc-cloud',
      baseUrl: 'https://router.test/v1',
      api: 'openai-completions',
      etag: 'catalog-1',
      recommendedModel: 'stable-model',
      lastSuccessAt: 1,
    }, [{
      id: 'stable-model', name: 'Stable Model', input: ['text'], reasoning: false,
      kind: 'language', output: ['text'], operations: ['chat.completions'],
      contextWindow: 128_000, maxOutputTokens: null,
    }]);
    const refreshModels = vi.fn();
    const source = new XopcCloudModelSource({
      fetchImpl: async () => Response.json({ object: 'list' }),
      credentials: { resolveApiKey: async () => 'oauth-access' },
      catalogStore: store,
      refreshModels,
    });

    await expect(source.refresh()).rejects.toMatchObject<XopcCloudModelError>({
      status: 200,
      code: 'invalid_response',
    });
    expect(store.getSource('xopc-cloud')).toMatchObject({
      etag: 'catalog-1',
      models: [{ id: 'stable-model', availability: 'available' }],
    });
    expect(refreshModels).not.toHaveBeenCalled();
  });
});
