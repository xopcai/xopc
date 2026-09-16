import { voiceFixture } from '../../voice/__tests__/voice-fixture.js';
import { describe, expect, it, vi } from 'vitest';

import { XopcCloudModelError, XopcCloudModelSource } from '../xopc-cloud-model-source.js';

describe('XopcCloudModelSource', () => {
  it('discovers a new conversation service without a vendor allowlist', async () => {
    const voice = voiceFixture(['conversation']);
    const source = new XopcCloudModelSource({credentials:{resolveApiKey:async () => 'token'},fetchImpl:async () => Response.json({data:[{id:'future-vendor',xopc:{kind:'omni',voice,capabilities:{input:['audio'],output:['audio','text']}}}]})});
    await expect(source.fetch()).resolves.toMatchObject({status:'fetched',models:[{id:'future-vendor',kind:'omni',operations:['audio.conversation'],voice}]});
  });
  it('retains localized names and public IDs, falling back for old catalogs', async () => {
    const source = new XopcCloudModelSource({
      credentials: { resolveApiKey: async () => 'token' },
      fetchImpl: async () => Response.json({ data: [
        { id: 'auto', xopc: { displayName: 'Standard', displayNames: { 'zh-CN': '标准', en: 'Standard' } } },
        { id: 'advanced', xopc: { displayName: 'Advanced', displayNames: { 'zh-CN': '高级', en: 42 } } },
        { id: 'legacy' },
      ] }),
    });
    await expect(source.fetch()).resolves.toMatchObject({ status: 'fetched', models: [
      { id: 'auto', name: 'Standard', displayNames: { 'zh-CN': '标准', en: 'Standard' } },
      { id: 'advanced', name: 'Advanced', displayNames: { 'zh-CN': '高级' } },
      { id: 'legacy', name: 'legacy' },
    ] });
  });

  it('skips discovery when OAuth is not configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const source = new XopcCloudModelSource({
      fetchImpl,
      credentials: { resolveApiKey: async () => null },
    });

    await expect(source.fetch()).resolves.toEqual({
      status: 'skipped',
      reason: 'not_configured',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches and validates an OAuth-authenticated catalog', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer oauth-access');
      return Response.json({
        object: 'list',
        xopc: {
          schemaVersion: 2,
          defaults: { 'image-generation': 'model-b', stt: 'stt-a', tts: 'tts-a', vision: 'missing' },
        },
        data: [
          {
            id: 'model-b',
            xopc: {
              kind: 'image',
              stability: 'stable',
              priority: 100,
              tier: 'free',
              bestEffort: false,
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
    });

    await expect(source.fetch()).resolves.toMatchObject({
      status: 'fetched',
      source: {
        providerId: 'xopc-cloud',
        baseUrl: 'https://router.test/v1',
        etag: 'catalog-2',
        recommended: { 'image-generation': 'model-b', stt: 'stt-a', tts: 'tts-a' },
      },
      models: [
        {
          id: 'model-b', kind: 'image', input: ['text'],
          output: ['image'], operations: ['images.generate'], reasoning: false,
          maxOutputTokens: null,
          imageGeneration: expect.objectContaining({ maxCount: 2, sizes: ['1024x1024'] }),
          stability: 'stable', priority: 100, tier: 'free', bestEffort: false,
        },
        {
          id: 'model-a', kind: 'language', input: ['text'],
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
  });

  it('preserves structured model service failures', async () => {
    const source = new XopcCloudModelSource({
      fetchImpl: async () => Response.json({
        error: { message: 'OAuth grant revoked', code: 'invalid_token' },
      }, { status: 401 }),
      credentials: { resolveApiKey: async () => 'expired-token' },
    });

    await expect(source.fetch()).rejects.toMatchObject<XopcCloudModelError>({
      name: 'XopcCloudModelError',
      status: 401,
      code: 'invalid_token',
      message: 'OAuth grant revoked',
    });
  });

  it('rejects a malformed successful response before it can be committed', async () => {
    const source = new XopcCloudModelSource({
      fetchImpl: async () => Response.json({ object: 'list' }),
      credentials: { resolveApiKey: async () => 'oauth-access' },
    });

    await expect(source.fetch()).rejects.toMatchObject<XopcCloudModelError>({
      status: 200,
      code: 'invalid_response',
    });
  });
});
