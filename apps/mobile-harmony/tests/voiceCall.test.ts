import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { send: vi.fn(), enqueue: vi.fn(), finish: vi.fn(), flush: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
});
vi.mock('@kit.AbilityKit', () => ({}));
vi.mock('@kit.ArkTS', () => ({ util: {} }));
vi.mock('@kit.PerformanceAnalysisKit', () => ({ hilog: { info: vi.fn() } }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: {} }));
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
    vi.clearAllMocks(); call = new XopcVoiceCall(); call.phase = 'connected';
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
});
