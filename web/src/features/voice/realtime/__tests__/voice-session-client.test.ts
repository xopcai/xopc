import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn() }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));
vi.mock('@/features/chat/session/session-manager', () => ({ SessionManager: class {} }));

import { VoiceSessionClient } from '../voice-session-client';

describe('voice client timing negotiation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([false, true])('keeps legacy gateways safe while reporting advertised metrics: %s', supported => {
    vi.stubGlobal('WebSocket', { OPEN: 1 });
    const send = vi.fn();
    const client = Object.assign(Object.create(VoiceSessionClient.prototype), {
      socket: { readyState: 1, send },
      timingMetrics: supported ? ['speech_end_to_audio_scheduled'] : [],
    }) as VoiceSessionClient;
    client.reportMetric('reply', 'speech_end_to_audio_received', 100);
    client.reportMetric('reply', 'speech_end_to_audio_scheduled', 180);
    const metrics = send.mock.calls.map(([text]) => JSON.parse(text).payload.metric);
    expect(metrics).toEqual(supported
      ? ['speech_end_to_audio_received', 'speech_end_to_audio_scheduled']
      : ['speech_end_to_audio_received']);
  });
});
