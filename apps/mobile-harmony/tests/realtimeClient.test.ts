import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), request: vi.fn() }));
vi.mock('@kit.NetworkKit', () => ({ webSocket: { createWebSocket: mocks.create } }));
vi.mock('@kit.BasicServicesKit', () => ({}));
vi.mock('@kit.PerformanceAnalysisKit', () => ({ hilog: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('../entry/src/main/ets/service/deviceCrypto.ets', () => ({ XopcDeviceCrypto: class {
  uuid() { return randomUUID(); } async publicKeyDer() { return 'public-key'; } async sign() { return 'signature'; }
} }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: {
  currentProfile: () => ({ deviceId: 'device-1' }), request: mocks.request,
  activeOrigin: () => 'https://gateway.example', verifyRoute: async () => {},
} }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({ XopcHttpError: class extends Error {
  constructor(public status: number) { super('HTTP_' + status); }
} }));
import { XopcRealtimeClient } from '../entry/src/main/ets/service/realtimeClient.ets';
import { XopcHttpError } from '../entry/src/main/ets/service/transport.ets';

class FakeSocket {
  listeners = new Map<string, (...args: any[]) => void>();
  send = vi.fn(async (_text: string) => {}); close = vi.fn(async () => {});
  connect = vi.fn(async (_url: string) => { this.listeners.get('open')?.(null, {}); });
  on(event: string, listener: (...args: any[]) => void) { this.listeners.set(event, listener); }
  off(event: string) { this.listeners.delete(event); }
  frame(kind: string, payload: object) { this.listeners.get('message')?.(null, JSON.stringify({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), kind, payload })); }
  ready() { this.frame('realtime.ready', { endpoint: { endpointId: 'harmonyos:device-1', turnToken: 'token' }, heartbeatIntervalMs: 15000, heartbeatTimeoutMs: 45000 }); }
  frames() { return this.send.mock.calls.map(([frame]) => JSON.parse(frame)); }
}

describe('Harmony realtime lifecycle', () => {
  let client: XopcRealtimeClient; let sockets: FakeSocket[];
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); sockets = [];
    mocks.create.mockImplementation(() => { const socket = new FakeSocket(); sockets.push(socket); return socket; });
    mocks.request.mockImplementation(async (path: string) => path.endsWith('/tickets') ? JSON.stringify({ payload: { ticket: 'ticket' } }) : '{}');
    client = new XopcRealtimeClient();
  });
  afterEach(() => { client.stop(); vi.useRealTimers(); });
  async function connect() { client.start(); await vi.advanceTimersByTimeAsync(0); sockets.at(-1)!.ready(); return sockets.at(-1)!; }
  it('authenticates with v2 hello and reconnects with the last sequence without duplicate events', async () => {
    client.subscribe('run:r1'); const socket = await connect(); const events = vi.fn(); client.onEvent = events;
    expect(socket.connect).toHaveBeenCalledWith('wss://gateway.example/api/realtime/v1/ws');
    expect(socket.frames()[0]).toMatchObject({ protocolVersion: 2, kind: 'realtime.hello', payload: { clientKind: 'mobile', ticket: 'ticket', subscriptions: [{ topic: 'run:r1', afterSeq: 0 }] } });
    const event = { topic: 'run:r1', seq: 1, event: 'assistant_delta', data: { text: 'a' } };
    socket.frame('realtime.event', event); socket.frame('realtime.event', event); expect(events).toHaveBeenCalledOnce();
    socket.listeners.get('close')?.(null, { code: 1006 }); await vi.advanceTimersByTimeAsync(1500);
    expect(sockets).toHaveLength(2); expect(sockets[1]!.frames()[0].payload.subscriptions).toEqual([{ topic: 'run:r1', afterSeq: 1 }]);
    expect(socket.listeners.size).toBe(0);
  });
  it('rebases restarted topic cursors and requests live subscription after an unrecoverable gap', async () => {
    client.subscribe('run:r1'); const socket = await connect(); const gap = vi.fn(); const event = vi.fn(); client.onGap = gap; client.onEvent = event;
    socket.frame('realtime.event', { topic: 'run:r1', seq: 80, event: 'assistant_delta', data: {} });
    socket.frame('realtime.gap', { topic: 'run:r1', requestedSeq: 80, earliestSeq: 1, recoverable: false });
    expect(gap).toHaveBeenCalledWith('run:r1');
    expect(socket.frames().at(-1)).toMatchObject({ kind: 'realtime.subscribe', payload: { subscriptions: [{ topic: 'run:r1' }] } });
    socket.frame('realtime.subscribed', { topic: 'run:r1', cursor: 0 });
    socket.frame('realtime.event', { topic: 'run:r1', seq: 1, event: 'assistant_delta', data: {} });
    expect(event).toHaveBeenCalledTimes(2);
    const sent = socket.send.mock.calls.length; client.subscribe('run:r1'); expect(socket.send.mock.calls).toHaveLength(sent);
  });
  it('accepts payload-free invalidations without entering a reconnect loop', async () => {
    client.subscribe('gateway'); const socket = await connect(); const events = vi.fn(); client.onEvent = events;
    socket.frame('realtime.event', { topic: 'gateway', seq: 1, event: 'config.reload', data: null });
    expect(client.turnClaim().endpointId).toBe('harmonyos:device-1'); expect(socket.close).not.toHaveBeenCalled();
    socket.frame('realtime.event', { topic: 'gateway', seq: 2, event: 'config.reload', data: {} });
    expect(events).toHaveBeenCalledOnce();
  });
  it('stops retrying revoked authentication and incompatible endpoint contracts', async () => {
    const states = vi.fn(); client.onState = states;
    mocks.request.mockRejectedValueOnce(new XopcHttpError(403));
    client.start(); await vi.advanceTimersByTimeAsync(60000);
    expect(states).toHaveBeenLastCalledWith('unauthorized'); expect(mocks.request).toHaveBeenCalledOnce();
    const socket = await connect(); socket.listeners.get('close')?.(null, { code: 4409 });
    await vi.advanceTimersByTimeAsync(60000); expect(states).toHaveBeenLastCalledWith('protocol_incompatible'); expect(sockets).toHaveLength(1);
  });
  it('releases timers and listeners on background stop', async () => {
    const socket = await connect(); client.stop(); const requests = mocks.request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000);
    expect(socket.listeners.size).toBe(0); expect(socket.close).toHaveBeenCalledOnce(); expect(mocks.request).toHaveBeenCalledTimes(requests);
    expect(() => client.turnClaim()).toThrow('REALTIME_NOT_READY');
  });
});
