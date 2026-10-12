import { voiceFixture } from '../../__tests__/voice-fixture.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { getModelCatalogStore, resetModelCatalogStore } from '../../../providers/model-catalog-store.js';

const { resolveApiKey, openPlatformTts } = vi.hoisted(() => ({ resolveApiKey: vi.fn(), openPlatformTts: vi.fn() }));
vi.mock('../../platform-streams.js', () => ({ openPlatformTts }));

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
      voice: voiceFixture(['speech']),
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
  it('sends the public voice ID in the handshake so the cloud can select its routing target', async () => {
    const source = getModelCatalogStore().getSource('xopc-cloud')!;
    source.models[0].voice!.modes = ['speech', 'speech.stream'];
    source.models[0].voice!.serviceVersion = 5;
    getModelCatalogStore().saveSource('xopc-cloud', source);
    const providerConfig = xopcCloudSpeechProvider.resolveConfig({ cfg: {} as Config,
      rawConfig: { 'xopc-cloud': { model: 'cloud-tts', voice: 'voice-ff846aef41c0346b' } }, timeoutMs: 30_000 });
    openPlatformTts.mockResolvedValue({ audioStream: new ReadableStream(), outputFormat: 'pcm' });
    await xopcCloudSpeechProvider.synthesizeStream!({ text: 'Hello', cfg: {} as Config, providerConfig,
      target: 'audio-file', timeoutMs: 30_000, signal: new AbortController().signal });
    const request = openPlatformTts.mock.calls.at(-1)![0];
    const url = new URL(request.baseUrl);
    expect(url.protocol).toBe('wss:');
    expect(url.searchParams.get('model')).toBe('cloud-tts');
    expect(url.searchParams.get('service_version')).toBe('5');
    expect(url.searchParams.get('voice')).toBe('voice-ff846aef41c0346b');
    expect(request.voice).toBe(url.searchParams.get('voice'));
  });
  it('lists only voices supporting the requested speech mode while retaining legacy voices', async () => {
    const source = getModelCatalogStore().getSource('xopc-cloud')!;
    source.models[0].voice!.voices.push(
      { id: 'http-only', name: 'HTTP voice', languages: ['zh'], modes: ['speech'] },
      { id: 'stream-only', name: 'Streaming voice', languages: ['zh'], modes: ['speech.stream'] },
    );
    getModelCatalogStore().saveSource('xopc-cloud', source);
    const providerConfig = xopcCloudSpeechProvider.resolveConfig({ cfg: {} as Config,
      rawConfig: { 'xopc-cloud': { model: 'cloud-tts' } }, timeoutMs: 30_000 });
    expect((await xopcCloudSpeechProvider.listVoices!({ providerConfig })).map(voice => voice.id)).toEqual(['voice-a', 'http-only']);
    expect((await xopcCloudSpeechProvider.listVoices!({ providerConfig, mode: 'speech.stream' })).map(voice => voice.id)).toEqual(['voice-a', 'stream-only']);
  });
  beforeEach(() => {
    seedCatalog();
    resolveApiKey.mockReset();
    resolveApiKey.mockResolvedValue('oauth-token');
  });

  afterEach(() => {
    resetModelCatalogStore();
    vi.unstubAllGlobals();
  });

  it('discovers voices from the published manifest', async () => {
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
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves multiple selectable voices and localized names from the cloud catalog', async () => {
    const source = getModelCatalogStore().getSource('xopc-cloud')!;
    source.models[0]!.voice!.voices.push({ id: 'voice-b', name: 'Warm voice', displayNames: { 'zh-CN': '温暖', en: 'Warm voice' }, languages: ['zh', 'en'] });
    getModelCatalogStore().saveSource('xopc-cloud', source);
    const providerConfig = xopcCloudSpeechProvider.resolveConfig({ cfg: {} as Config,
      rawConfig: { 'xopc-cloud': { model: 'cloud-tts' } }, timeoutMs: 30_000 });
    expect(await xopcCloudSpeechProvider.listVoices?.({ providerConfig })).toEqual([
      { id: 'voice-a', name: 'Voice A' },
      { id: 'voice-b', name: 'Warm voice', displayNames: { 'zh-CN': '温暖', en: 'Warm voice' } },
    ]);
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
