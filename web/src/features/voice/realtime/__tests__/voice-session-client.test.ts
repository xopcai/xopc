import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn() }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));
vi.mock('@/features/chat/session/session-manager', () => ({ SessionManager: class {} }));

import { VoiceSessionClient } from '../voice-session-client';
import { fetchJson } from '@/lib/fetch';

describe('voice client timing negotiation', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

  it.each([undefined, 'assistant'] as const)('negotiates an opening before any input when the requested mode is %s', async (mode) => {
    const stopped = new Error('Stop before opening WebSocket');
    vi.mocked(fetchJson).mockResolvedValueOnce({ payload: { openingGreeting: true } }).mockRejectedValueOnce(stopped);
    const logicalCallId = crypto.randomUUID();
    await expect(VoiceSessionClient.connect({ purpose: 'conversation', mode, logicalCallId,
      conversationId: 'personal-call', onEvent: vi.fn() })).rejects.toThrow(stopped);
    expect(fetchJson).toHaveBeenNthCalledWith(1, '/api/voice/realtime/status', expect.any(Object));
    const request = JSON.parse(String(vi.mocked(fetchJson).mock.calls[1][1]?.body));
    expect(request.openingGreeting).toEqual({ logicalCallId, initiation: 'user', supportsOutputReady: true });
  });

  it('leaves explicit natural calls without the assistant opening handshake', async () => {
    vi.mocked(fetchJson).mockRejectedValueOnce(new Error('Stop before opening WebSocket'));
    await expect(VoiceSessionClient.connect({ purpose: 'conversation', mode: 'natural',
      logicalCallId: crypto.randomUUID(), onEvent: vi.fn() })).rejects.toThrow();
    expect(fetchJson).toHaveBeenCalledOnce();
    const request = JSON.parse(String(vi.mocked(fetchJson).mock.calls[0][1]?.body));
    expect(request).not.toHaveProperty('openingGreeting');
  });

  it.each([false, true])('sends output readiness only when greeting was accepted: %s', accepted => {
    vi.stubGlobal('WebSocket', { OPEN: 1 });
    const send = vi.fn();
    const client = Object.assign(Object.create(VoiceSessionClient.prototype), {
      socket: { readyState: 1, send }, session: { connectionEpoch: 7, openingGreeting: { accepted } },
    }) as VoiceSessionClient;
    client.outputReady();
    expect(send).toHaveBeenCalledTimes(accepted ? 1 : 0);
    if (accepted) expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({ type: 'session.output_ready', payload: { connectionEpoch: 7 } });
  });

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
