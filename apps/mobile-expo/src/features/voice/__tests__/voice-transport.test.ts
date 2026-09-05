import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { encodeVoiceAudioFrame, type CreateVoiceSessionResponse } from '@xopcai/realtime-protocol/voice';
import { VoiceTransport } from '../voice-transport';

class Socket {
  static OPEN = 1;
  static latest: Socket;
  readyState = 1; bufferedAmount = 0; binaryType = '';
  onopen?: () => void; onmessage?: (event: { data: unknown }) => void; onclose?: () => void; onerror?: () => void;
  send = vi.fn(); close = vi.fn(() => { this.readyState = 3; this.onclose?.(); });
  constructor(readonly url: string) { Socket.latest = this; }
}
const session = { sessionId: randomUUID(), ticket: 'secret-ticket', websocketPath: '/api/voice/realtime/v2/ws', route: { engine: 'omni', omni: { provider: 'p', model: 'm', managed: true } } } as CreateVoiceSessionResponse;
function ready() {
  Socket.latest.onopen?.();
  Socket.latest.onmessage?.({ data: JSON.stringify({ protocolVersion: 2, sessionId: session.sessionId, eventId: randomUUID(), seq: 1, type: 'session.ready', sentAt: Date.now(), payload: { purpose: 'conversation', inputMode: 'server_vad', inputFormat: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 }, route: session.route, heartbeatIntervalMs: 15000 } }) });
}
function harness() {
  vi.stubGlobal('WebSocket', Socket);
  const callbacks = { audio: vi.fn(), event: vi.fn(), close: vi.fn() };
  return { callbacks, transport: new VoiceTransport(callbacks) };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('mobile voice transport', () => {
  it('pins WSS to the ticket origin and keeps the ticket out of the URL', async () => {
    const h = harness(); const connecting = h.transport.connect('https://paired.example', session, new AbortController().signal);
    ready(); await connecting;
    expect(Socket.latest.url).toBe('wss://paired.example/api/voice/realtime/v2/ws');
    expect(JSON.parse(Socket.latest.send.mock.calls[0][0]).payload.ticket).toBe(session.ticket);
    h.transport.close();
  });
  it('rejects unverified cleartext routes before opening a socket', async () => {
    const h = harness(); await expect(h.transport.connect('http://paired.example', session, new AbortController().signal)).rejects.toThrow('SECURE_ROUTE_REQUIRED');
  });
  it('rejects a ticket path pointing to another origin', async () => {
    const h = harness();
    await expect(h.transport.connect('https://paired.example', { ...session, websocketPath: 'https://other.example/ws' } as never, new AbortController().signal)).rejects.toThrow('SECURE_ROUTE_REQUIRED');
  });
  it('settles a failed handshake send without reporting an established connection', async () => {
    const h = harness();
    const connecting = h.transport.connect('https://paired.example', session, new AbortController().signal);
    Socket.latest.send.mockImplementation(() => { throw new Error('offline'); });
    Socket.latest.onopen?.();
    await expect(connecting).rejects.toThrow('NETWORK');
    expect(h.callbacks.close).not.toHaveBeenCalled();
  });
  it('delivers only sequential audio and reports a protocol failure once', async () => {
    const h = harness(); const connecting = h.transport.connect('https://paired.example', session, new AbortController().signal);
    ready(); await connecting;
    const frame = (seq: number) => encodeVoiceAudioFrame({ responseId: 'answer', seq, audio: new Uint8Array([0, 0]) }).buffer;
    Socket.latest.onmessage?.({ data: frame(1) }); Socket.latest.onmessage?.({ data: frame(3) });
    expect(h.callbacks.audio).toHaveBeenCalledOnce();
    expect(h.callbacks.close).toHaveBeenCalledExactlyOnceWith('PROTOCOL_ERROR');
  });
  it('closing a ready socket does not recursively reconnect', async () => {
    const h = harness(); const connecting = h.transport.connect('https://paired.example', session, new AbortController().signal);
    ready(); await connecting; Socket.latest.onerror?.();
    expect(h.callbacks.close).toHaveBeenCalledExactlyOnceWith('NETWORK');
    expect(Socket.latest.close).toHaveBeenCalledOnce();
  });
  it('bounds input buffering and releases an aborted handshake', async () => {
    const h = harness(); const abort = new AbortController();
    const connecting = h.transport.connect('https://paired.example', session, abort.signal);
    abort.abort(); await expect(connecting).rejects.toThrow('CANCELLED');
    const next = harness(); const opening = next.transport.connect('https://paired.example', session, new AbortController().signal);
    ready(); await opening; Socket.latest.bufferedAmount = 70000;
    expect(() => next.transport.audio(new Uint8Array([0, 0]))).toThrow('INPUT_DROPPED');
    next.transport.close();
  });
});
