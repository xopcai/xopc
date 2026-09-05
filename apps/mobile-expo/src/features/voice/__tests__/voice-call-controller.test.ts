import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceCallController, type CallDependencies } from '../voice-call-controller';
import type { VoiceTransportCallbacks } from '../voice-transport';

const target = { gatewayId: 'gateway', sessionKey: 'chat', background: false };
function harness() {
  let callbacks: VoiceTransportCallbacks;
  let audioCallbacks: Parameters<CallDependencies['audio']['start']>[1];
  const transport = { connect: vi.fn(async () => {}), send: vi.fn(), audio: vi.fn(), close: vi.fn() };
  const deps: CallDependencies = {
    audio: { start: vi.fn(async (_background, value) => { audioCallbacks = value; }), capture: vi.fn(), flush: vi.fn(async () => {}), stop: vi.fn(async () => {}), enqueue: vi.fn(async () => {}) },
    prepare: vi.fn(async () => ({ identity: 'original', name: 'Assistant', engine: 'omni' as const })),
    create: vi.fn(async () => ({ origin: 'https://gateway', session: { limits: { maxSessionMs: 60000 } } as never })),
    transport: vi.fn(value => { callbacks = value; return transport; }), invalidate: vi.fn(),
  };
  const controller = new VoiceCallController(deps);
  const event = (type: string, payload: Record<string, unknown>) => callbacks.event({ type, payload } as never);
  return { controller, deps, transport, event, audio: () => audioCallbacks, connection: () => callbacks };
}
afterEach(() => vi.useRealTimers());

describe('mobile persistent voice controller', () => {
  it('stops locally without sending an input or accepting late audio', async () => {
    const h = harness(); await h.controller.start(target);
    h.event('response.created', { responseId: 'old' });
    await h.controller.stopReply();
    h.connection().audio('old', new Uint8Array([0, 0]));
    expect(h.deps.audio.flush).toHaveBeenCalledOnce();
    expect(h.deps.audio.enqueue).not.toHaveBeenCalled();
    expect(h.transport.send.mock.calls.map(call => call[0])).toEqual(['input.mute', 'session.metric', 'response.cancel']);
    expect(h.controller.getSnapshot().phase).toBe('connected');
    h.event('session.error', { code: 'NO_ACTIVE_RESPONSE', recoverable: true });
    expect(h.controller.getSnapshot().error).toBeUndefined();
    await h.controller.end();
  });
  it('never opens the microphone after a cancelled pending start', async () => {
    const h = harness();
    let release!: () => void;
    vi.mocked(h.deps.audio.start).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const start = h.controller.start(target);
    await vi.waitFor(() => expect(release).toBeDefined());
    const end = h.controller.end(); release(); await Promise.all([start, end]);
    expect(h.deps.create).not.toHaveBeenCalled();
    expect(h.deps.audio.capture).not.toHaveBeenCalledWith(true);
    expect(h.controller.getSnapshot().phase).toBe('idle');
  });
  it('keeps mute intent when resuming and rejects callbacks from the previous connection', async () => {
    const h = harness(); await h.controller.start(target);
    const old = h.audio(); await h.controller.setMuted(true);
    await h.controller.pause('network'); await h.controller.resume();
    old.pcm(new Uint8Array([1, 2])); h.audio().pcm(new Uint8Array([1, 2]));
    expect(h.transport.audio).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().muted).toBe(true);
    expect(h.deps.audio.capture).toHaveBeenLastCalledWith(false);
    await h.controller.end();
  });
  it('keeps the same target when opened from another Chat', async () => {
    const h = harness(); await h.controller.start(target);
    h.controller.expand(false); await h.controller.start({ ...target, sessionKey: 'other' });
    expect(h.deps.create).toHaveBeenCalledOnce();
    expect(h.controller.getSnapshot().target?.sessionKey).toBe('chat');
    expect(h.controller.getSnapshot().expanded).toBe(true);
    await h.controller.end();
  });
  it('does not resume across a Chat reset', async () => {
    const h = harness(); await h.controller.start(target); await h.controller.pause('network');
    vi.mocked(h.deps.prepare).mockResolvedValue({ identity: 'reset', name: 'Assistant', engine: 'omni' });
    await h.controller.resume();
    expect(h.deps.create).toHaveBeenCalledOnce();
    expect(h.controller.getSnapshot().error).toBe('SESSION_CHANGED');
    await h.controller.end();
  });
  it('hangup wins over a simultaneous interruption cleanup', async () => {
    const h = harness(); await h.controller.start(target);
    await Promise.all([h.controller.pause('interruption'), h.controller.end()]);
    expect(h.controller.getSnapshot().phase).toBe('idle');
  });
  it('waits for native played bytes and never treats receipt as playback', async () => {
    const h = harness(); await h.controller.start(target);
    h.event('response.created', { responseId: 'answer' });
    h.connection().audio('answer', new Uint8Array([0, 0, 0, 0]));
    h.event('response.done', { responseId: 'answer' });
    expect(h.controller.getSnapshot().responseId).toBe('answer');
    expect(h.transport.send).not.toHaveBeenCalledWith('response.audio.played', expect.anything());
    h.audio().played('answer', 4);
    expect(h.controller.getSnapshot().responseId).toBeUndefined();
    await h.controller.end();
  });
  it('pauses microphone input for explicit clarification', async () => {
    const h = harness(); await h.controller.start(target);
    h.event('response.created', { responseId: 'answer' });
    h.event('response.clarification', { responseId: 'answer', requestId: 'request', question: 'Choose' });
    h.audio().pcm(new Uint8Array([1, 2]));
    expect(h.transport.audio).not.toHaveBeenCalled();
    h.controller.confirmationSent(); await Promise.resolve();
    expect(h.controller.getSnapshot().clarification).toBeUndefined();
    await h.controller.end();
  });
  it('never automatically retries an ambiguous creation request', async () => {
    const h = harness(); vi.mocked(h.deps.create).mockRejectedValue(new Error('NETWORK'));
    await h.controller.start(target);
    expect(h.controller.getSnapshot().phase).toBe('paused');
    expect(h.deps.create).toHaveBeenCalledOnce();
    await h.controller.end();
  });
  it('does not enable capture when initial mute delivery fails', async () => {
    const h = harness();
    h.transport.send.mockImplementation(type => { if (type === 'input.mute') h.connection().close('PROTOCOL_ERROR'); });
    await h.controller.start(target);
    await vi.waitFor(() => expect(h.controller.getSnapshot().phase).toBe('paused'));
    expect(h.deps.audio.capture).not.toHaveBeenCalledWith(true);
    await h.controller.end();
  });
  it('ignores clarification belonging to a stopped response', async () => {
    const h = harness(); await h.controller.start(target);
    h.event('response.created', { responseId: 'old' });
    await h.controller.stopReply();
    h.event('response.clarification', { responseId: 'old', requestId: 'stale', question: 'Choose' });
    expect(h.controller.getSnapshot().clarification).toBeUndefined();
    await h.controller.end();
  });
});
