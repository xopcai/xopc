import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { getModelCatalogStore, resetModelCatalogStore } from '../../../providers/model-catalog-store.js';

const { resolveApiKey } = vi.hoisted(() => ({ resolveApiKey: vi.fn() }));

vi.mock('../../../providers/provider-auth-service.js', () => ({
  getProviderAuthService: () => ({ resolveApiKey }),
}));

import { xopcCloudSpeechProvider } from '../providers/xopc-cloud-speech.js';

function seedCatalog(): void {
  getModelCatalogStore().saveSource('xopc-cloud', {
    providerId: 'xopc-cloud',
    baseUrl: 'https://models.example/v1',
    api: 'openai-completions',
    etag: null,
    recommendedModel: null,
    lastSuccessAt: 1,
    models: [{
      id: 'cloud-tts', name: 'Cloud TTS', availability: 'available', kind: 'tts',
      input: ['text'], output: ['audio'], operations: ['audio.speech'],
      reasoning: false, contextWindow: 0, maxOutputTokens: null,
      tts: {
        maxCharacters: 4096, languages: ['zh'], outputFormats: ['mp3'],
        streaming: false, speed: true, pitch: false, instructions: true,
        defaultVoice: 'voice-a',
      },
    }],
  });
}

describe('xopcCloudSpeechProvider', () => {
  beforeEach(() => {
    seedCatalog();
    resolveApiKey.mockReset();
    resolveApiKey.mockResolvedValue('oauth-token');
  });

  afterEach(() => {
    resetModelCatalogStore();
    vi.unstubAllGlobals();
  });

  it('discovers model voices through XOPC Cloud OAuth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      data: [{ id: 'voice-a', name: 'Voice A' }, { id: 'voice-b' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const providerConfig = xopcCloudSpeechProvider.resolveConfig({
      cfg: {} as Config,
      rawConfig: { 'xopc-cloud': { model: 'cloud-tts' } },
      timeoutMs: 30_000,
    });

    await expect(xopcCloudSpeechProvider.listVoices?.({ providerConfig })).resolves.toEqual([
      { id: 'voice-a', name: 'Voice A' },
      { id: 'voice-b' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://models.example/v1/audio/voices?model=cloud-tts',
      expect.objectContaining({ headers: { authorization: 'Bearer oauth-token' } }),
    );
  });

  it('passes supported voice controls to the unified speech endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(Uint8Array.from([1, 2, 3]), {
      headers: { 'content-type': 'audio/mpeg' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const providerConfig = xopcCloudSpeechProvider.resolveConfig({
      cfg: {} as Config,
      rawConfig: {
        'xopc-cloud': {
          model: 'cloud-tts', voice: 'voice-b', speed: 1.25, instructions: 'Speak warmly.',
        },
      },
      timeoutMs: 30_000,
    });

    await xopcCloudSpeechProvider.synthesize?.({
      text: '你好', cfg: {} as Config, providerConfig, target: 'audio-file', timeoutMs: 30_000,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'cloud-tts', input: '你好', voice: 'voice-b', response_format: 'mp3',
      speed: 1.25, instructions: 'Speak warmly.',
    });
  });
});
