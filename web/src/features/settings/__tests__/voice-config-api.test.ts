import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchJson, revalidateGatewayConfig } = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  revalidateGatewayConfig: vi.fn(),
}));

vi.mock('@/lib/fetch', () => ({ fetchJson }));
vi.mock('@/features/gateway/gateway-config-swr', () => ({ revalidateGatewayConfig }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));

import { normalizeVoiceSettings, patchVoiceSettings } from '../voice-config-api';

describe('voice-config-api', () => {
  beforeEach(() => {
    fetchJson.mockReset();
    revalidateGatewayConfig.mockReset();
  });

  it('uses user-safe defaults and disables hidden transcript refinement', () => {
    const state = normalizeVoiceSettings({});

    expect(state.stt.enabled).toBe(true);
    expect(state.tts.enabled).toBe(true);
    expect(state.stt.provider).toBe('xopc-local');
    expect(state.stt.fallback).toEqual({ enabled: false, order: ['xopc-local'] });
    expect(state.tts.trigger).toBe('inbound');
    expect(state.tts.timeoutMs).toBe(60_000);
    expect(state.voice.input.refinement.mode).toBe('off');
    expect(state.voice.languageMode).toBe('auto');
  });

  it('round-trips explicit refinement in the safe config patch', async () => {
    fetchJson.mockResolvedValue({ ok: true });
    const state = normalizeVoiceSettings({
      voice: { input: { refinement: { mode: 'punctuation', model: 'openai/gpt-test' } } },
    });

    await patchVoiceSettings(state);

    const init = fetchJson.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      voice: {
        input: { refinement: { mode: 'punctuation', model: 'openai/gpt-test' } },
      },
      tts: { trigger: 'inbound', timeoutMs: 60_000 },
    });
    expect(fetchJson).toHaveBeenNthCalledWith(2, '/api/voice/language', {
      method: 'POST',
      body: JSON.stringify({ language: 'en' }),
    });
  });

  it('keeps every TTS provider in the unified providers map', async () => {
    fetchJson.mockResolvedValue({ ok: true });
    const state = normalizeVoiceSettings({
      tts: {
        enabled: true,
        provider: 'xopc-cloud',
        providers: {
          'xopc-cloud': { model: 'cloud-tts', voice: 'voice-a' },
          openai: { model: 'gpt-4o-mini-tts', voice: 'coral' },
        },
      },
    });

    expect(state.tts.providers?.['xopc-cloud']).toEqual({ model: 'cloud-tts', voice: 'voice-a' });
    await patchVoiceSettings(state);

    const init = fetchJson.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(init.body)) as { tts: Record<string, unknown> };
    expect(payload.tts.providers).toMatchObject({
      'xopc-cloud': { model: 'cloud-tts', voice: 'voice-a' },
      openai: { model: 'gpt-4o-mini-tts', voice: 'coral' },
    });
    expect(payload.tts).not.toHaveProperty('openai');
    expect(payload.tts).not.toHaveProperty('alibaba');
    expect(payload.tts).not.toHaveProperty('minimax');
    expect(payload.tts).not.toHaveProperty('edge');
  });

  it('keeps every STT provider in the unified providers map', async () => {
    fetchJson.mockResolvedValue({ ok: true });
    const state = normalizeVoiceSettings({
      stt: {
        enabled: true,
        provider: 'xopc-cloud',
        providers: {
          'xopc-cloud': { model: 'cloud-stt', language: 'zh' },
          alibaba: { apiKey: 'secret', model: 'qwen-audio-3.0-asr-flash' },
        },
      },
    });

    expect(state.stt.providers?.['xopc-cloud']).toEqual({ model: 'cloud-stt', language: 'zh' });
    await patchVoiceSettings(state);

    const init = fetchJson.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(init.body)) as { stt: Record<string, unknown> };
    expect(payload.stt.providers).toMatchObject({
      'xopc-cloud': { model: 'cloud-stt', language: 'zh' },
      alibaba: { apiKey: 'secret', model: 'qwen-audio-3.0-asr-flash' },
    });
    expect(payload.stt).not.toHaveProperty('openai');
    expect(payload.stt).not.toHaveProperty('alibaba');
  });
});
