import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), warn: vi.fn(), info: vi.fn(), now: 1000 }));
vi.mock('@kit.NetworkKit', () => ({ webSocket: { createWebSocket: mocks.create } }));
vi.mock('@kit.BasicServicesKit', () => ({ systemDateTime: { TimeType: { STARTUP: 1 }, getUptime: () => mocks.now } }));
vi.mock('@kit.PerformanceAnalysisKit', () => ({ hilog: { warn: mocks.warn, info: mocks.info } }));
vi.mock('@kit.ArkTS', () => ({ util: {
  generateRandomUUID: () => randomUUID(),
  TextEncoder: class { encodeInto(value: string): Uint8Array { return new TextEncoder().encode(value); } },
  TextDecoder: class { decodeToString(value: Uint8Array): string { return new TextDecoder('utf-8', { fatal: true }).decode(value); } },
} }));

import { XopcVoiceCallTransport } from '../entry/src/main/ets/service/voiceCallTransport.ets';

class FakeSocket {
  listeners = new Map<string, (...args: any[]) => void>();
  send = vi.fn(async () => true);
  close = vi.fn(async () => {});
  connect = vi.fn(async () => { this.listeners.get('open')?.({ code: 0 }, {}); });
  on(event: string, listener: (...args: any[]) => void): void { this.listeners.set(event, listener); }
  off(event: string): void { this.listeners.delete(event); }
  event(seq: number, type: string, payload: object): void {
    this.listeners.get('message')?.({ code: 0 }, JSON.stringify({
      protocolVersion: 3, eventId: randomUUID(), seq, type, sentAt: Date.now(), sessionId: 'voice-session', payload,
    }));
  }
}

function audioIdentity(frame: ArrayBuffer): { id: string; seq: number } {
  const bytes = new Uint8Array(frame); const header = new DataView(frame);
  const idLength = header.getUint16(26);
  return { id: new TextDecoder().decode(bytes.slice(32, 32 + idLength)), seq: header.getUint32(12) };
}

describe('Harmony realtime voice transport diagnostics', () => {
  let socket: FakeSocket;
  beforeEach(() => { vi.clearAllMocks(); mocks.now = 1000; socket = new FakeSocket(); mocks.create.mockReturnValue(socket); });

  it('preserves a fatal server error code and logs the transport shutdown reason', async () => {
    const close = vi.fn();
    const transport = new XopcVoiceCallTransport({ onEvent: vi.fn(), onAudio: vi.fn(), onClose: close, onRtt: vi.fn() });
    const connected = transport.connect('https://gateway.example', {
      sessionId: 'voice-session', ticket: 'ticket', ticketExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      websocketPath: '/api/voice/realtime/v3/ws', protocolVersion: 3, connectionEpoch: 7,
      purpose: 'conversation', mode: 'natural', inputMode: 'continuous', bargeIn: true,
      inputFormat: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      media: { transport: 'websocket-pcm', codec: 'pcm_s16le', frameDurationMs: 20 },
      limits: { maxBinaryFrameBytes: 65536, maxSessionMs: 60000, idleTimeoutMs: 30000 }, route: { engine: 'omni' },
    });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    socket.event(1, 'session.ready', { connectionEpoch: 7, heartbeatIntervalMs: 15000, route: { engine: 'omni' } });
    await connected;
    socket.event(2, 'session.error', { code: 'OMNI_PROVIDER_ERROR', recoverable: false });
    expect(close).toHaveBeenCalledWith('OMNI_PROVIDER_ERROR');
    expect(mocks.warn).toHaveBeenCalledWith(0x0000, 'XopcVoice', 'Voice session failed: %{public}s', 'OMNI_PROVIDER_ERROR');
    expect(mocks.warn).toHaveBeenCalledWith(0x0000, 'XopcVoice', 'Voice transport stopped: %{public}s', 'OMNI_PROVIDER_ERROR');
  });

  it('serializes audio frames before sending them to the native WebSocket', async () => {
    let releaseFirst!: () => void;
    let blocked = false;
    socket.send.mockImplementation((value) => {
      if (value instanceof ArrayBuffer && !blocked) { blocked = true; return new Promise<boolean>((resolve) => { releaseFirst = () => resolve(true); }); }
      return Promise.resolve(true);
    });
    const transport = new XopcVoiceCallTransport({ onEvent: vi.fn(), onAudio: vi.fn(), onClose: vi.fn(), onRtt: vi.fn() });
    const connected = transport.connect('https://gateway.example', {
      sessionId: 'voice-session', ticket: 'ticket', ticketExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      websocketPath: '/api/voice/realtime/v3/ws', protocolVersion: 3, connectionEpoch: 7,
      purpose: 'conversation', mode: 'natural', inputMode: 'continuous', bargeIn: true,
      inputFormat: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      media: { transport: 'websocket-pcm', codec: 'pcm_s16le', frameDurationMs: 20 },
      limits: { maxBinaryFrameBytes: 65536, maxSessionMs: 60000, idleTimeoutMs: 30000 }, route: { engine: 'omni' },
    });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(1));
    socket.event(1, 'session.ready', { connectionEpoch: 7, heartbeatIntervalMs: 15000, route: { engine: 'omni' } });
    await connected; transport.send('input.mute', { muted: false }); transport.audio(new Uint8Array(1280));
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(3));
    expect(socket.send.mock.calls[2]?.[0]).toBeInstanceOf(ArrayBuffer);
    releaseFirst();
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(4));
    expect([audioIdentity(socket.send.mock.calls[2]?.[0]), audioIdentity(socket.send.mock.calls[3]?.[0])].map((item) => item.seq)).toEqual([1, 2]);
  });

  it('keeps the same utterance for duplicate unmuted state updates', async () => {
    const transport = new XopcVoiceCallTransport({ onEvent: vi.fn(), onAudio: vi.fn(), onClose: vi.fn(), onRtt: vi.fn() });
    const connected = transport.connect('https://gateway.example', {
      sessionId: 'voice-session', ticket: 'ticket', ticketExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      websocketPath: '/api/voice/realtime/v3/ws', protocolVersion: 3, connectionEpoch: 7,
      purpose: 'conversation', mode: 'assistant', inputMode: 'continuous', bargeIn: true,
      inputFormat: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      media: { transport: 'websocket-pcm', codec: 'pcm_s16le', frameDurationMs: 20 },
      limits: { maxBinaryFrameBytes: 65536, maxSessionMs: 60000, idleTimeoutMs: 30000 }, route: { engine: 'agent' },
    });
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    socket.event(1, 'session.ready', { connectionEpoch: 7, heartbeatIntervalMs: 15000, route: { engine: 'agent' } });
    await connected;
    transport.send('input.mute', { muted: false }); transport.audio(new Uint8Array(640));
    transport.send('input.mute', { muted: false }); transport.audio(new Uint8Array(640));
    await vi.waitFor(() => expect(socket.send.mock.calls.filter(([value]) => value instanceof ArrayBuffer)).toHaveLength(2));
    const frames = socket.send.mock.calls.filter(([value]) => value instanceof ArrayBuffer).map(([value]) => audioIdentity(value));
    expect(frames[0]?.id).toBe(frames[1]?.id); expect(frames.map((frame) => frame.seq)).toEqual([1, 2]);
  });
  async function readyTransport(onClose = vi.fn()): Promise<XopcVoiceCallTransport> {
    const transport = new XopcVoiceCallTransport({ onEvent: vi.fn(), onAudio: vi.fn(), onClose, onRtt: vi.fn() });
    const session = {
      sessionId: 'voice-session', ticket: 'ticket', ticketExpiresAt: new Date(Date.now() + 60000).toISOString(),
      websocketPath: '/api/voice/realtime/v3/ws', protocolVersion: 3, connectionEpoch: 7,
      purpose: 'conversation', mode: 'natural', inputMode: 'continuous', bargeIn: true,
      inputFormat: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      media: { transport: 'websocket-pcm', codec: 'pcm_s16le', frameDurationMs: 20 },
      limits: { maxBinaryFrameBytes: 65536, maxSessionMs: 60000, idleTimeoutMs: 30000 }, route: { engine: 'omni' },
    };
    const connected = transport.connect('https://gateway.example', session);
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    socket.event(1, 'session.ready', { connectionEpoch: 7, heartbeatIntervalMs: 15000, route: { engine: 'omni' } });
    await connected; transport.send('input.mute', { muted: false });
    return transport;
  }

  it('keeps a fresh 120 ms batch healthy and interpolates capture timestamps', async () => {
    const transport = await readyTransport();
    const result = transport.audio(new Uint8Array(3840), 880);
    expect(result).toEqual({ accepted: true, quality: 'good', queueAgeMs: 0 });
    expect(transport.inputDiagnostics()).toMatchObject({ queuedAudioMs: 120, oldestWaitMs: 0 });
    expect(transport.inputDiagnostics().queuedWireBytes).toBeGreaterThan(3840);
    await vi.waitFor(() => expect(socket.send.mock.calls.filter(([v]) => v instanceof ArrayBuffer)).toHaveLength(6));
    const frames = socket.send.mock.calls.filter(([v]) => v instanceof ArrayBuffer);
    expect(frames.map(([v]) => new DataView(v).getFloat64(16))).toEqual([880, 900, 920, 940, 960, 980]);
    await transport.close();
  });

  it('discards unsent audio on mute and starts a new utterance after unmute', async () => {
    const transport = await readyTransport();
    let release!: () => void;
    socket.send.mockImplementation((v) => v instanceof ArrayBuffer
      ? new Promise<boolean>((resolve) => { release = () => resolve(true); }) : Promise.resolve(true));
    transport.audio(new Uint8Array(3840));
    await vi.waitFor(() => expect(socket.send.mock.calls.filter(([v]) => v instanceof ArrayBuffer)).toHaveLength(1));
    mocks.now += 150;
    expect(transport.inputQueueAgeMs()).toBe(150);
    transport.send('input.mute', { muted: true });
    expect(transport.inputDiagnostics()).toMatchObject({ queuedAudioMs: 20, droppedAudioMs: 100 });
    expect(transport.audio(new Uint8Array(640)).accepted).toBe(false);
    release();
    await vi.waitFor(() => expect(transport.inputQueueAgeMs()).toBe(0));
    socket.send.mockImplementation(async () => true);
    transport.send('input.mute', { muted: false }); transport.audio(new Uint8Array(640));
    await vi.waitFor(() => expect(socket.send.mock.calls.filter(([v]) => v instanceof ArrayBuffer)).toHaveLength(2));
    const identities = socket.send.mock.calls.filter(([v]) => v instanceof ArrayBuffer).map(([v]) => audioIdentity(v));
    expect(identities[0].id).not.toBe(identities[1].id);
    expect(identities.map((v) => v.seq)).toEqual([1, 1]);
    await transport.close();
  });

  it('bounds PCM allocation and rejects old input by elapsed wait', async () => {
    const transport = await readyTransport();
    expect(transport.audio(new Uint8Array(9601))).toMatchObject({ accepted: false, quality: 'critical' });
    expect(transport.inputDiagnostics().queuedAudioMs).toBe(0);
    let release!: () => void;
    socket.send.mockImplementation((v) => v instanceof ArrayBuffer
      ? new Promise<boolean>((resolve) => { release = () => resolve(true); }) : Promise.resolve(true));
    transport.audio(new Uint8Array(640));
    await vi.waitFor(() => expect(socket.send.mock.calls.filter(([v]) => v instanceof ArrayBuffer)).toHaveLength(1));
    mocks.now += 301;
    expect(transport.audio(new Uint8Array(640))).toEqual({ accepted: false, quality: 'critical', queueAgeMs: 301 });
    release(); await transport.close();
  });

  it('stops the session instead of replaying expired queued input', async () => {
    const closed = vi.fn(); const transport = await readyTransport(closed);
    let release!: () => void;
    socket.send.mockImplementation((v) => v instanceof ArrayBuffer
      ? new Promise<boolean>((resolve) => { release = () => resolve(true); }) : Promise.resolve(true));
    transport.audio(new Uint8Array(1280));
    await vi.waitFor(() => expect(socket.send.mock.calls.filter(([v]) => v instanceof ArrayBuffer)).toHaveLength(1));
    mocks.now += 301; release();
    await vi.waitFor(() => expect(closed).toHaveBeenCalledWith('INPUT_DROPPED'));
    expect(socket.send.mock.calls.filter(([v]) => v instanceof ArrayBuffer)).toHaveLength(1);
    expect(transport.inputDiagnostics().droppedAudioMs).toBe(20);
    await transport.close();
  });

});
