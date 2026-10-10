import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn(), send: vi.fn(), enqueue: vi.fn(), finish: vi.fn(), flush: vi.fn(async () => {}), stop: vi.fn(async () => {}), duck: vi.fn(), setMuted: vi.fn(), now: 1000 };
});
vi.mock('@kit.AbilityKit', () => ({}));
vi.mock('@kit.BasicServicesKit', () => ({ systemDateTime: { TimeType: { STARTUP: 1 }, getUptime: () => mocks.now } }));
vi.mock('@kit.ArkTS', () => ({ util: {} }));
vi.mock('@kit.PerformanceAnalysisKit', () => ({ hilog: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mocks.request } }));
vi.mock('../entry/src/main/ets/repository/chatRepository.ets', () => ({ XopcChatRepository: class {} }));
vi.mock('../entry/src/main/ets/service/voiceCapture.ets', () => ({ voiceCapture: {} }));
vi.mock('../entry/src/main/ets/service/chatReadAloud.ets', () => ({ chatReadAloud: {} }));
vi.mock('../entry/src/main/ets/service/voiceCallAudio.ets', () => ({ voiceCallAudio: mocks }));
vi.mock('../entry/src/main/ets/service/voiceCallTransport.ets', () => ({ XopcVoiceCallTransport: class {} }));

import { XopcVoiceCall } from '../entry/src/main/ets/service/voiceCall.ets';
import type { XopcVoiceAudioFrame, XopcVoiceServerEvent } from '../entry/src/main/ets/model/voice.ets';

type CallHarness = {
  transport: { send: typeof mocks.send; close: () => Promise<void> };
  onEvent(event: XopcVoiceServerEvent): void;
  onAudio(frame: XopcVoiceAudioFrame): void;
  played(id: string, milliseconds: number): void;
  buffered(id: string, milliseconds: number): void;
  supportedTimingMetrics: string[];
  release(clearSession: boolean): Promise<void>;
};
function event(type: string, responseId: string, payload: object = {}): XopcVoiceServerEvent {
  return { protocolVersion: 3, eventId: type, seq: 1, type, sentAt: 1, sessionId: 'session', payload: { responseId, ...payload } };
}
function frame(responseId: string): XopcVoiceAudioFrame {
  return { connectionEpoch: 1, responseId, seq: 1, mediaTimestampMs: 0, durationMs: 20, audio: new Uint8Array(960) };
}

describe('Harmony continuous voice call response handoff', () => {
  let call: XopcVoiceCall;
  let harness: CallHarness;
  beforeEach(() => {
    vi.clearAllMocks(); mocks.now = 1000; call = new XopcVoiceCall(); call.phase = 'connected';
    harness = call as unknown as CallHarness;
    harness.transport = { send: mocks.send, close: async () => {} };
  });

  it('releases a fully played response when its completion event arrives', () => {
    harness.onEvent(event('response.created', 'first'));
    harness.onAudio(frame('first')); harness.played('first', 20);
    harness.onEvent(event('response.done', 'first', { audio: true }));
    harness.onEvent(event('response.created', 'second'));
    harness.onAudio(frame('second'));
    expect(call.responseId).toBe('second');
    expect(mocks.send).not.toHaveBeenCalledWith('response.stop_playback', { responseId: 'second' });
    expect(mocks.enqueue).toHaveBeenLastCalledWith('second', expect.any(Uint8Array));
  });

  it('preserves the next reply while the previous renderer drain is pending', () => {
    harness.onEvent(event('response.created', 'first')); harness.onAudio(frame('first'));
    harness.onEvent(event('response.done', 'first', { audio: true }));
    harness.onEvent(event('response.created', 'second'));
    harness.onEvent(event('response.text.delta', 'second', { delta: 'Second answer' }));
    harness.onAudio(frame('second'));
    expect(call.responseId).toBe('first');
    expect(mocks.send).not.toHaveBeenCalledWith('response.stop_playback', { responseId: 'second' });
    harness.played('first', 20);
    expect(call.responseId).toBe('second'); expect(call.assistantText).toBe('Second answer');
    expect(mocks.enqueue).toHaveBeenLastCalledWith('second', expect.any(Uint8Array));
    harness.onEvent(event('response.done', 'second', { audio: true })); harness.played('second', 20);
    harness.onEvent(event('response.created', 'third')); harness.onAudio(frame('third'));
    expect(call.responseId).toBe('third');
  });

  it('clears old reply ownership and queued audio before reconnecting', async () => {
    harness.onEvent(event('response.created', 'first')); harness.onAudio(frame('first'));
    harness.onEvent(event('response.done', 'first', { audio: true }));
    harness.onEvent(event('response.created', 'second')); harness.onAudio(frame('second'));
    await harness.release(false);
    expect(call.responseId).toBe(''); expect(call.responseStage).toBe('');
    harness.transport = { send: mocks.send, close: async () => {} };
    harness.onEvent(event('response.created', 'reconnected')); harness.onAudio(frame('reconnected'));
    harness.played('first', 20);
    expect(call.responseId).toBe('reconnected');
    expect(mocks.enqueue.mock.calls.filter(([id]) => id === 'second')).toHaveLength(0);
  });

  it('keeps a queued reply after the user stops the previous playback', async () => {
    harness.onEvent(event('response.created', 'first')); harness.onAudio(frame('first'));
    harness.onEvent(event('response.done', 'first', { audio: true }));
    harness.onEvent(event('response.created', 'second')); harness.onAudio(frame('second'));
    await call.stopReply();
    expect(mocks.flush).toHaveBeenCalledOnce();
    expect(call.responseId).toBe('second');
    expect(mocks.send).toHaveBeenCalledWith('response.stop_playback', { responseId: 'first' });
    expect(mocks.send).not.toHaveBeenCalledWith('response.stop_playback', { responseId: 'second' });
  });

  it('retains active-reply cancellation protection before server completion', () => {
    harness.onEvent(event('response.created', 'first'));
    harness.onEvent(event('response.created', 'unexpected'));
    expect(call.responseId).toBe('first');
    expect(mocks.send).toHaveBeenCalledWith('response.stop_playback', { responseId: 'unexpected' });
  });
  it('keeps user mute in force when congestion recovers', async () => {
    vi.useFakeTimers();
    try {
      const state = call as any;
      state.transport.inputDiagnostics = () => ({ oldestWaitMs: 150 });
      state.transport.inputQueueAgeMs = () => 0;
      state.applyQuality({ accepted: true, quality: 'degraded', queueAgeMs: 150 });
      await call.setMuted(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(mocks.send).not.toHaveBeenCalledWith('input.mute', { muted: false });
      expect(mocks.setMuted).toHaveBeenLastCalledWith(true);
      await harness.release(false);
    } finally { vi.useRealTimers(); }
  });

  it('keeps approval mute in force when congestion recovers', async () => {
    vi.useFakeTimers();
    try {
      const state = call as any;
      state.transport.inputDiagnostics = () => ({ oldestWaitMs: 150 });
      state.transport.inputQueueAgeMs = () => 0;
      state.applyQuality({ accepted: false, quality: 'critical', queueAgeMs: 300 });
      state.approval = { id: 'pending' };
      await vi.advanceTimersByTimeAsync(100);
      expect(mocks.send).not.toHaveBeenCalledWith('input.mute', { muted: false });
      expect(mocks.setMuted).toHaveBeenLastCalledWith(true);
      await harness.release(false);
    } finally { vi.useRealTimers(); }
  });

  it('ducks on server speech onset and ignores stale stop events from other utterances', () => {
    (call as any).session = { bargeIn: true };
    harness.onEvent(event('response.created', 'reply')); harness.onAudio(frame('reply'));
    harness.onEvent(event('input.speech_started', '', { utteranceId: 'user' }));
    expect(mocks.duck).toHaveBeenLastCalledWith(true);
    harness.onEvent(event('input.speech_stopped', '', { utteranceId: 'old' }));
    expect(mocks.duck).toHaveBeenLastCalledWith(true);
    harness.onEvent(event('input.speech_stopped', '', { utteranceId: 'user' }));
    expect(mocks.duck).toHaveBeenLastCalledWith(false);
  });

  it.each([false, true])('reports first native buffering only when advertised: %s', supported => {
    harness.supportedTimingMetrics = supported ? ['speech_end_to_audio_buffered'] : [];
    harness.onEvent(event('input.speech_started', '', { utteranceId: 'user' }));
    mocks.now = 1100;
    harness.onEvent(event('input.speech_stopped', '', { utteranceId: 'user' }));
    harness.onEvent(event('response.created', 'reply'));
    mocks.now = 1300; harness.onAudio(frame('reply'));
    mocks.now = 1350; harness.buffered('reply', 20); harness.buffered('reply', 40);
    const metrics = mocks.send.mock.calls.filter(([type, payload]) => type === 'session.metric'
      && payload.metric === 'speech_end_to_audio_buffered');
    expect(metrics).toEqual(supported ? [['session.metric', {
      responseId: 'reply', metric: 'speech_end_to_audio_buffered', durationMs: 250,
    }]] : []);
  });

  it('emits receipt latency once and honors disabled barge-in', () => {
    (call as any).session = { bargeIn: false };
    harness.onEvent(event('input.speech_started', '', { utteranceId: 'user' }));
    mocks.now = 1100;
    harness.onEvent(event('input.speech_stopped', '', { utteranceId: 'user' }));
    harness.onEvent(event('response.created', 'reply'));
    mocks.now = 1300; harness.onAudio(frame('reply')); harness.onAudio(frame('reply'));
    expect(mocks.send.mock.calls.filter(([type]) => type === 'session.metric')).toEqual([
      ['session.metric', { responseId: 'reply', metric: 'speech_end_to_audio_received', durationMs: 200 }],
    ]);
    harness.onEvent(event('input.speech_started', '', { utteranceId: 'next' }));
    expect(mocks.duck).toHaveBeenLastCalledWith(false);
  });

  it('ignores an approval fetch that resolves after releasing the call', async () => {
    let resolve!: (value: string) => void;
    mocks.request.mockImplementationOnce(() => new Promise<string>((r) => { resolve = r; }));
    const state = call as any; state.target = { conversationId: 'conversation' };
    const loading = state.loadApproval();
    await harness.release(false);
    resolve(JSON.stringify({ payload: { approvals: [{ id: 'stale', conversationId: 'conversation',
      status: 'pending', expiresAt: new Date(Date.now() + 60000).toISOString() }] } }));
    await loading;
    expect(call.approval).toBeUndefined();
    expect(mocks.send).not.toHaveBeenCalledWith('input.mute', { muted: true });
  });

});
