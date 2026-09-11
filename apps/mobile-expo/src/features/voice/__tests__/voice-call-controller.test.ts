import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceCallController, type CallDependencies } from '../voice-call-controller';
import type { VoiceAudioSendResult, VoiceTransportCallbacks } from '../voice-transport';

const target = { gatewayId: 'gateway', sessionKey: 'chat', background: false };
function harness() {
  let callbacks: VoiceTransportCallbacks;
  let audioCallbacks: Parameters<CallDependencies['audio']['start']>[1];
  const transport = { connect: vi.fn(async () => {}), send: vi.fn(),
    audio: vi.fn<() => VoiceAudioSendResult>(() => ({ accepted: true, quality: 'good', queueAgeMs: 0 })),
    inputQueueAgeMs: vi.fn(() => 0), close: vi.fn() };
  const deps: CallDependencies = {
    audio: { start: vi.fn(async (_background, value) => { audioCallbacks = value; return { output: 'speaker' as const, echoControl: 'verified' as const, fullDuplex: true }; }),
      capture: vi.fn(), flush: vi.fn(async () => {}), stop: vi.fn(async () => {}), enqueue: vi.fn(async () => {}),
      duck: vi.fn(async () => {}), resumeOutput: vi.fn(async () => {}) },
    prepare: vi.fn(async () => ({ identity: 'original', name: 'Assistant', mode: 'natural' as const, engine: 'omni' as const })),
    create: vi.fn(async () => ({ origin: 'https://gateway', session: { limits: { maxSessionMs: 60000 } } as never })),
    discard: vi.fn(async () => {}),
    transport: vi.fn(value => { callbacks = value; return transport; }), invalidate: vi.fn(),
  };
  const controller = new VoiceCallController(deps);
  const event = (type: string, payload: Record<string, unknown>) => callbacks.event({ type, payload } as never);
  return { controller, deps, transport, event, audio: () => audioCallbacks, connection: () => callbacks };
}
afterEach(() => vi.useRealTimers());

describe('mobile persistent voice controller', () => {
  it('captures audio progress and preserves diagnostics after hanging up', async () => {
    const h = harness(); await h.controller.start(target);
    h.event('response.created', { responseId: 'answer' });
    h.event('response.text.delta', { responseId: 'answer', delta: 'Hello' });
    h.connection().audio('answer', new Uint8Array([1, 0, 2, 0]));
    await vi.waitFor(() => expect(h.deps.audio.enqueue).toHaveBeenCalled());
    h.audio().played('answer', 4);
    h.event('response.done', { responseId: 'answer', audio: true, finishReason: 'completed' });
    await h.controller.end();
    expect(h.controller.getDiagnostics()).toMatchObject({ phase: 'idle', finding: 'played', responses: [
      { textCharacters: 5, receivedBytes: 4, queuedBytes: 4, playedBytes: 4, peakAmplitude: 2, finishReason: 'completed' },
    ] });
  });
  it('distinguishes generation, received audio, and native playback progress', async () => {
    const h = harness(); await h.controller.start(target);
    h.event('response.created', { responseId: 'answer' });
    expect(h.controller.getSnapshot().responseStage).toBe('thinking');
    h.connection().audio('answer', new Uint8Array(4800));
    expect(h.controller.getSnapshot().responseStage).toBe('buffering');
    h.audio().played('answer', 2400);
    expect(h.controller.getSnapshot().responseStage).toBe('speaking');
    h.event('response.done', { responseId: 'answer', audio: true });
    h.audio().played('answer', 4800);
    expect(h.controller.getSnapshot().responseStage).toBeUndefined();
    await h.controller.end();
  });

  it('keeps capture open on a verified full-duplex route', async () => {
    vi.useFakeTimers();
    const h = harness(); await h.controller.start(target);
    vi.mocked(h.deps.audio.capture).mockClear();
    h.event('response.created', { responseId: 'answer' });
    h.connection().audio('answer', new Uint8Array(4800));
    expect(h.deps.audio.capture).not.toHaveBeenCalledWith(false);
    await h.controller.end();
  });

  it('drops only congested input and resumes capture without pausing the call', async () => {
    vi.useFakeTimers();
    const h = harness(); await h.controller.start(target);
    h.transport.audio.mockReturnValueOnce({ accepted: false, quality: 'critical', queueAgeMs: 300 });
    h.transport.inputQueueAgeMs.mockReturnValueOnce(200).mockReturnValueOnce(79);
    h.audio().pcm(new Uint8Array(640));
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'connected', networkQuality: 'critical', error: 'INPUT_DROPPED' });
    await vi.advanceTimersByTimeAsync(100);
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'connected', networkQuality: 'good' });
    expect(h.deps.audio.capture).toHaveBeenLastCalledWith(true);
    await h.controller.end();
  });

  it('pauses capture before degraded upload becomes a drop', async () => {
    vi.useFakeTimers();
    const h = harness(); await h.controller.start(target);
    h.transport.audio.mockReturnValueOnce({ accepted: true, quality: 'degraded', queueAgeMs: 120 });
    h.transport.inputQueueAgeMs.mockReturnValueOnce(79);
    h.audio().pcm(new Uint8Array(640));
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'connected', networkQuality: 'degraded', error: undefined });
    expect(h.deps.audio.capture).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(h.controller.getSnapshot().networkQuality).toBe('good');
    expect(h.deps.audio.capture).toHaveBeenLastCalledWith(true);
    await h.controller.end();
  });

  it('ducks for near speech and restores output for a false candidate', async () => {
    const h = harness(); await h.controller.start(target);
    h.event('response.created', { responseId: 'answer' });
    h.connection().audio('answer', new Uint8Array(4800));
    h.audio().speechCandidate(true);
    expect(h.deps.audio.duck).toHaveBeenCalledOnce();
    h.audio().speechCandidate(false);
    expect(h.deps.audio.resumeOutput).toHaveBeenCalledOnce();
    await h.controller.end();
  });

  it('holds capture for the whole reply when echo control is unavailable', async () => {
    const h = harness(); await h.controller.start(target);
    h.audio().route({ output: 'speaker', echoControl: 'none', fullDuplex: false });
    vi.mocked(h.deps.audio.capture).mockClear();
    h.event('response.created', { responseId: 'answer' });
    h.connection().audio('answer', new Uint8Array(4800));
    expect(h.deps.audio.capture).toHaveBeenLastCalledWith(false);
    h.audio().played('answer', 4800);
    h.event('response.done', { responseId: 'answer', audio: true, finishReason: 'completed' });
    expect(h.deps.audio.capture).toHaveBeenLastCalledWith(true);
    await h.controller.end();
  });

  it('pauses with a playback error when arriving audio makes no native progress', async () => {
    vi.useFakeTimers();
    const h = harness(); await h.controller.start(target);
    h.event('response.created', { responseId: 'answer' });
    h.connection().audio('answer', new Uint8Array(4800));
    await vi.advanceTimersByTimeAsync(3000);
    h.connection().audio('answer', new Uint8Array(4800));
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'paused', error: 'PLAYBACK_STALLED' });
    expect(h.deps.audio.stop).toHaveBeenCalled();
    await h.controller.end();
  });

  it('allows long generation gaps once all received audio has played', async () => {
    vi.useFakeTimers();
    const h = harness(); await h.controller.start(target);
    h.event('response.created', { responseId: 'answer' });
    h.connection().audio('answer', new Uint8Array(4800));
    h.audio().played('answer', 4800);
    await vi.advanceTimersByTimeAsync(6000);
    expect(h.controller.getSnapshot().phase).toBe('connected');
    expect(h.controller.getSnapshot().responseStage).toBe('thinking');
    h.connection().audio('answer', new Uint8Array(4800));
    expect(h.controller.getSnapshot().responseStage).toBe('buffering');
    await vi.advanceTimersByTimeAsync(4000);
    h.audio().played('answer', 7200);
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.controller.getSnapshot().phase).toBe('connected');
    await h.controller.stopReply();
    await vi.advanceTimersByTimeAsync(6000);
    expect(h.controller.getSnapshot().error).toBeUndefined();
    await h.controller.end();
  });

  it('reports text-only replies and clears the old failure on a new response', async () => {
    const h = harness(); await h.controller.start(target);
    h.event('response.created', { responseId: 'answer' });
    h.event('response.text.delta', { responseId: 'answer', delta: 'Hello' });
    h.event('response.done', { responseId: 'answer', audio: false });
    expect(h.controller.getSnapshot().error).toBe('NO_RESPONSE_AUDIO');
    h.event('response.created', { responseId: 'next' });
    expect(h.controller.getSnapshot().error).toBeUndefined();
    await h.controller.end();
  });

  it('keeps a generation failure instead of replacing it with a text-only warning', async () => {
    const h = harness(); await h.controller.start(target);
    h.event('response.created', { responseId: 'answer' });
    h.event('response.text.delta', { responseId: 'answer', delta: 'Hello' });
    h.event('session.error', { code: 'RESPONSE_FAILED', recoverable: true });
    h.event('response.done', { responseId: 'answer', audio: false });
    expect(h.controller.getSnapshot().error).toBe('RESPONSE_FAILED');
    await h.controller.end();
  });
  it('stops locally without sending an input or accepting late audio', async () => {
    const h = harness(); await h.controller.start(target);
    h.event('response.created', { responseId: 'old' });
    await h.controller.stopReply();
    h.connection().audio('old', new Uint8Array([0, 0]));
    expect(h.deps.audio.flush).toHaveBeenCalledOnce();
    expect(h.deps.audio.enqueue).not.toHaveBeenCalled();
    expect(h.transport.send.mock.calls.map(call => call[0])).toEqual(['input.mute', 'session.metric', 'response.stop_playback']);
    expect(h.controller.getSnapshot().phase).toBe('connected');
    h.event('session.error', { code: 'NO_ACTIVE_RESPONSE', recoverable: true });
    expect(h.controller.getSnapshot().error).toBeUndefined();
    await h.controller.end();
  });
  it('stops playback without cancelling the durable task and supports explicit task cancellation', async () => {
    const h = harness(); await h.controller.start(target);
    h.event('response.created', { responseId: 'answer' });
    h.event('task.created', { responseId: 'answer', taskId: 'task-1' });
    h.event('task.activity', { taskId: 'task-1', toolCallId: 'tool-1', toolName: 'search', status: 'running' });
    await h.controller.stopReply();
    expect(h.controller.getSnapshot()).toMatchObject({ taskId: 'task-1', taskStage: 'running', activity: 'search' });
    expect(h.transport.send).not.toHaveBeenCalledWith('task.cancel', expect.anything());
    h.controller.cancelTask();
    expect(h.transport.send).toHaveBeenCalledWith('task.cancel', { taskId: 'task-1' });
    expect(h.controller.getSnapshot().taskStage).toBe('cancelling');
    h.event('task.done', { taskId: 'task-1', status: 'cancelled' });
    expect(h.controller.getSnapshot().taskId).toBeUndefined();
    await h.controller.end();
  });
  it('finishes cancelling old playback before enqueueing a new response', async () => {
    const h = harness(); await h.controller.start(target);
    let finishFlush!: () => void;
    vi.mocked(h.deps.audio.flush).mockImplementationOnce(() => new Promise(resolve => { finishFlush = resolve; }));
    h.event('response.created', { responseId: 'old' });
    h.event('response.cancelled', { responseId: 'old', reason: 'barge_in' });
    h.event('response.created', { responseId: 'new' });
    h.connection().audio('new', new Uint8Array([1, 0]));
    await Promise.resolve();
    expect(h.deps.audio.enqueue).not.toHaveBeenCalled();
    finishFlush();
    await vi.waitFor(() => expect(h.deps.audio.enqueue).toHaveBeenCalledWith('new', new Uint8Array([1, 0])));
    await h.controller.end();
  });
  it('never opens the microphone after a cancelled pending start', async () => {
    const h = harness();
    let release!: () => void;
    vi.mocked(h.deps.audio.start).mockImplementation(() => new Promise(resolve => { release = () => resolve({ output: 'speaker', echoControl: 'verified', fullDuplex: true }); }));
    const start = h.controller.start(target);
    await vi.waitFor(() => expect(release).toBeDefined());
    const end = h.controller.end(); release(); await Promise.all([start, end]);
    expect(h.deps.create).toHaveBeenCalledOnce();
    expect(h.deps.discard).toHaveBeenCalledOnce();
    expect(h.deps.audio.capture).not.toHaveBeenCalledWith(true);
    expect(h.controller.getSnapshot().phase).toBe('idle');
  });
  it('creates the remote session while native audio is still starting', async () => {
    const h = harness();
    let release!: () => void;
    vi.mocked(h.deps.audio.start).mockImplementation(() => new Promise(resolve => { release = () => resolve({ output: 'speaker', echoControl: 'verified', fullDuplex: true }); }));
    const start = h.controller.start(target);
    await vi.waitFor(() => expect(h.deps.create).toHaveBeenCalledOnce());
    expect(h.transport.connect).not.toHaveBeenCalled();
    release();
    await start;
    expect(h.transport.connect).toHaveBeenCalledOnce();
    await h.controller.end();
  });
  it('discards an issued ticket when native audio startup fails', async () => {
    const h = harness();
    vi.mocked(h.deps.audio.start).mockRejectedValueOnce(new Error('PERMISSION_DENIED'));
    await h.controller.start(target);
    await vi.waitFor(() => expect(h.deps.discard).toHaveBeenCalledOnce());
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'paused', error: 'PERMISSION_DENIED' });
    expect(h.transport.connect).not.toHaveBeenCalled();
    await h.controller.end();
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
    vi.mocked(h.deps.prepare).mockResolvedValue({ identity: 'reset', name: 'Assistant', mode: 'natural', engine: 'omni' });
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
