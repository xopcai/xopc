import { describe, expect, it } from 'vitest';
import { VoiceReceiveState } from './voice-receive-state.js';
import type { CreateVoiceSessionResponse, VoiceServerEvent } from './voice.js';

const session: CreateVoiceSessionResponse = {
  sessionId: 'session', ticket: 'ticket', ticketExpiresAt: new Date().toISOString(),
  websocketPath: '/api/voice/realtime/v3/ws', protocolVersion: 3, connectionEpoch: 2,
  purpose: 'conversation', mode: 'natural', inputMode: 'server_vad', bargeIn: true,
  inputFormat: {encoding: 'pcm_s16le', sampleRate: 16000, channels: 1},
  media: {transport: 'websocket-pcm', codec: 'pcm_s16le', frameDurationMs: 20},
  limits: {maxBinaryFrameBytes: 65536, maxSessionMs: 60000, idleTimeoutMs: 30000},
  route: {engine: 'omni', omni: {provider: 'arbitrary', model: 'new-model', managed: true}},
};
const ready = (): VoiceServerEvent => ({protocolVersion: 3, sessionId: session.sessionId, eventId: 'ready', seq: 1, type: 'session.ready', sentAt: 1,
  payload: {purpose: session.purpose, mode: session.mode, connectionEpoch: 2, inputMode: session.inputMode, inputFormat: session.inputFormat, media: session.media, route: session.route, heartbeatIntervalMs: 15000}});
const frame = (seq = 1, responseId = 'response') => ({connectionEpoch: 2, responseId, seq, mediaTimestampMs: (seq - 1) * 20, durationMs: 20 as const, audio: new Uint8Array(960)});

describe('shared native and browser voice receive state', () => {
  it('requires negotiated readiness and rejects wrong epochs or sequence gaps', () => {
    const state = new VoiceReceiveState(session);
    expect(() => state.audio(frame())).toThrow();
    state.event(ready());
    expect(() => state.audio({...frame(), connectionEpoch: 1})).toThrow();
    expect(state.audio(frame())).toBe(true);
    expect(() => state.audio(frame(3))).toThrow();
  });
  it('drops late cancelled audio while continuing sequence validation for the next response', () => {
    const state = new VoiceReceiveState(session); state.event(ready());
    state.cancel('response'); state.cancel('response');
    expect(state.audio(frame())).toBe(false);
    expect(state.audio(frame(2, 'next'))).toBe(true);
    expect(() => state.audio(frame(2, 'next'))).toThrow();
  });
  it('rejects session confusion and repeated readiness', () => {
    expect(() => new VoiceReceiveState(session).event({...ready(), sessionId: 'other'})).toThrow();
    const event = ready();
    if (event.type !== 'session.ready') throw new Error('fixture');
    expect(() => new VoiceReceiveState(session).event({...event,payload:{...event.payload,connectionEpoch: 9}})).toThrow();
    const state = new VoiceReceiveState(session); state.event(event);
    expect(() => state.event({...event,seq:2})).toThrow();
  });
});
