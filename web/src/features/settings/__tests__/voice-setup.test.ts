import { describe, expect, it } from 'vitest';

import { normalizeVoiceSettings } from '../voice-config-api';
import { configureRealtimeService } from '../voice-setup';

describe('voice service setup', () => {
  it('configures Qwen without replacing readout or provider credentials', () => {
    const form = normalizeVoiceSettings({ stt: { enabled: true, provider: 'alibaba', providers: { alibaba: { apiKey: '***' } } }, tts: { enabled: true, provider: 'edge', trigger: 'inbound' } });
    const next = configureRealtimeService(form, 'alibaba');
    expect(next.tts).toBe(form.tts);
    expect(next.stt.providers).toBe(form.stt.providers);
    expect(next.voice.realtime).toMatchObject({ enabled: true, tts: { provider: 'alibaba', voice: 'Cherry' } });
    expect(normalizeVoiceSettings(next).voice.realtime).toEqual(next.voice.realtime);
  });

  it('switches to hosted voice without carrying an Alibaba voice or copying a key', () => {
    const form = configureRealtimeService(normalizeVoiceSettings({}), 'alibaba');
    const next = configureRealtimeService(form, 'xopc-cloud');
    expect(next.stt.provider).toBe('xopc-cloud');
    expect(next.voice.realtime.tts).toEqual({ provider: 'xopc-cloud' });
    expect(next.tts).toBe(form.tts);
  });
});
