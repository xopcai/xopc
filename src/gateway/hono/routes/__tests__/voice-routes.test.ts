import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';

const { transcribe, syncVoiceLanguage } = vi.hoisted(() => ({
  transcribe: vi.fn(),
  syncVoiceLanguage: vi.fn(),
}));

vi.mock('../../../../voice/stt/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../voice/stt/index.js')>();
  return { ...actual, isSTTAvailable: () => true, transcribe };
});

import { registerVoiceRoutes } from '../voice.js';

function createApp() {
  const app = new Hono();
  const config = ConfigSchema.parse({});
  config.tools.media = {
    audio: {
      enabled: true,
      provider: 'openai',
      providers: { openai: { apiKey: 'test' } },
    },
  };
  registerVoiceRoutes(app, {
    service: { currentConfig: config, syncVoiceLanguage },
    strictRateLimitMiddleware: async (_c, next) => next(),
  } as never);
  return app;
}

describe('voice transcription routes', () => {
  beforeEach(() => {
    transcribe.mockReset();
    syncVoiceLanguage.mockReset();
    syncVoiceLanguage.mockResolvedValue({ applied: true, language: 'zh', mode: 'auto' });
    transcribe.mockResolvedValue({
      text: 'hello',
      provider: 'openai',
      attempts: [{ provider: 'openai', task: 'success', reasonCode: 'success', latencyMs: 12 }],
      attemptedProviders: ['openai'],
    });
  });

  it('accepts multipart audio and preserves its MIME type and file name', async () => {
    const form = new FormData();
    form.append('audio', new File(['audio'], 'sample.wav', { type: 'audio/wav' }));

    const res = await createApp().request('/api/voice/transcriptions', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(200);
    expect(transcribe).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ enabled: true }),
      expect.objectContaining({ mime: 'audio/wav', fileName: 'sample.wav', signal: expect.any(AbortSignal) }),
    );
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      payload: { raw: 'hello', provider: 'openai' },
    });
  });

  it('keeps the legacy JSON/base64 endpoint compatible', async () => {
    const res = await createApp().request('/api/voice/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        audio: Buffer.from('audio').toString('base64'),
        mimeType: 'audio/ogg',
        fileName: 'legacy.ogg',
      }),
    });

    expect(res.status).toBe(200);
    expect(transcribe).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.any(Object),
      expect.objectContaining({ mime: 'audio/ogg', fileName: 'legacy.ogg' }),
    );
  });

  it('syncs the product language through the gateway policy', async () => {
    const res = await createApp().request('/api/voice/language', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'zh' }),
    });

    expect(res.status).toBe(200);
    expect(syncVoiceLanguage).toHaveBeenCalledWith('zh');
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      payload: { applied: true, language: 'zh', mode: 'auto' },
    });
  });

  it('rejects unsupported product languages', async () => {
    const res = await createApp().request('/api/voice/language', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'fr' }),
    });

    expect(res.status).toBe(400);
    expect(syncVoiceLanguage).not.toHaveBeenCalled();
  });
});
