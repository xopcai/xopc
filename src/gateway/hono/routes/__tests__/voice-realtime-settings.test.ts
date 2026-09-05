import { Hono } from 'hono';
import { realtimeVoiceStatusSchema } from '@xopcai/realtime-protocol/voice';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';

const { speakStream } = vi.hoisted(() => ({ speakStream: vi.fn() }));
vi.mock('../../../../voice/tts/speak-core.js', async (original) => ({
  ...await original<typeof import('../../../../voice/tts/speak-core.js')>(), speakStream,
}));

import { registerVoiceRoutes } from '../voice.js';

function app(withOutput = true) {
  const config = ConfigSchema.parse({
    voice: { language: 'zh', realtime: { enabled: true, ...(withOutput ? { tts: { provider: 'alibaba', voice: 'Cherry' } } : {}) } },
    tools: { media: { audio: { enabled: true, provider: 'alibaba', providers: { alibaba: { apiKey: 'private-key' } } } } },
    messages: { tts: { enabled: false, provider: 'edge' } },
  });
  const hono = new Hono();
  registerVoiceRoutes(hono, {
    service: { currentConfig: config },
    strictRateLimitMiddleware: async (_c, next) => next(),
  } as never);
  return hono;
}

describe('realtime voice setup endpoints', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports actual routes without credentials or a verified claim', async () => {
    const response = await app().request('/api/voice/realtime/status');
    const data = await response.json();
    expect(data).toMatchObject({ ok: true, payload: {
      enabled: true, stt: { provider: 'alibaba' }, tts: { provider: 'alibaba', voice: 'Cherry' },
    } });
    expect(JSON.stringify(data)).not.toContain('private-key');
    expect(data.payload).not.toHaveProperty('verified');
    expect(realtimeVoiceStatusSchema.parse(data.payload).capabilities.agent.available).toBe(true);
    expect(speakStream).not.toHaveBeenCalled();
  });

  it('keeps dictation configured when realtime output is unavailable', async () => {
    const response = await app(false).request('/api/voice/realtime/status');
    expect(await response.json()).toMatchObject({ payload: {
      stt: { provider: 'alibaba' }, tts: null,
      capabilities: { dictation: { available: true }, agent: { available: false, reasonCode: 'PROVIDER_UNAVAILABLE' } },
    } });
    expect((await app(false).request('/api/voice/realtime/preview', { method: 'POST' })).status).toBe(503);
    expect(speakStream).not.toHaveBeenCalled();
  });

  it('discovers realtime voices using the shared input credential', async () => {
    const response = await app().request('/api/voice/tts-voices?purpose=realtime&provider=alibaba&model=qwen3-tts-flash-realtime');
    expect(await response.json()).toMatchObject({ payload: { voices: expect.arrayContaining([{ id: 'Cherry', name: 'Cherry' }]) } });
  });

  it('previews a bounded fixed sample using native PCM and releases the provider', async () => {
    const release = vi.fn();
    speakStream.mockResolvedValue({ outputFormat: 'pcm', release, audioStream: new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4])); controller.close(); },
    }) });
    const response = await app().request('/api/voice/realtime/preview', { method: 'POST', body: JSON.stringify({ text: 'ignored user text' }) });
    expect(await response.json()).toMatchObject({ payload: { audio: 'AQIDBA==', sampleRate: 24_000 } });
    expect(speakStream).toHaveBeenCalledWith(expect.stringContaining('你好'), expect.objectContaining({
      provider: 'alibaba', providers: { alibaba: expect.objectContaining({ apiKey: 'private-key', voice: 'Cherry' }) },
    }), expect.objectContaining({ allowFallback: false, signal: expect.any(AbortSignal) }));
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([0, 3, 960_002])('rejects an invalid or oversized preview of %i bytes', async (size) => {
    const release = vi.fn();
    speakStream.mockResolvedValue({ outputFormat: 'pcm', release, audioStream: new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(size)); controller.close(); },
    }) });
    expect((await app().request('/api/voice/realtime/preview', { method: 'POST' })).status).toBe(502);
    expect(release).toHaveBeenCalledOnce();
  });
});
