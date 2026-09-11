import { describe, expect, it } from 'vitest';

import {
  VOICE_REALTIME_PROTOCOL_VERSION,
  createVoiceSessionRequestSchema,
  parseVoiceClientMessage,
  parseVoiceServerEvent,
  encodeVoiceAudioFrame,
  encodeVoiceUplinkAudioFrame,
  decodeVoiceAudioFrame,
  decodeVoiceUplinkAudioFrame,
} from './voice.js';

describe('voice realtime protocol', () => {
  const negotiation = {
    supportedProtocolVersions: [VOICE_REALTIME_PROTOCOL_VERSION] as const,
    mediaPreferences: ['websocket-pcm'] as const,
  };

  it('accepts conversation modes and rejects them for dictation', () => {
    expect(createVoiceSessionRequestSchema.safeParse({ purpose: 'conversation', sessionKey: 'test', ...negotiation }).success).toBe(true);
    for (const mode of ['assistant', 'natural']) {
      expect(createVoiceSessionRequestSchema.safeParse({ purpose: 'conversation', sessionKey: 'test', mode, ...negotiation }).success).toBe(true);
      expect(createVoiceSessionRequestSchema.safeParse({ purpose: 'dictation', mode, ...negotiation }).success).toBe(false);
    }
  });

  it('round trips tagged audio and rejects old or malformed frames', () => {
    const audio = new Uint8Array([1, 2, 3, 4]);
    const frame = encodeVoiceAudioFrame({ connectionEpoch: 2, responseId: 'response-1', seq: 3, mediaTimestampMs: 40, durationMs: 20, audio });
    expect(decodeVoiceAudioFrame(frame)).toEqual({ connectionEpoch: 2, responseId: 'response-1', seq: 3, mediaTimestampMs: 40, durationMs: 20, audio });
    expect(() => decodeVoiceAudioFrame(audio)).toThrow();
    expect(() => decodeVoiceAudioFrame(frame.subarray(0, frame.length - 1))).toThrow();
    frame[0] = 0;
    expect(() => decodeVoiceAudioFrame(frame)).toThrow();
    expect(() => encodeVoiceAudioFrame({ connectionEpoch: 2, responseId: 'x', seq: 0, mediaTimestampMs: 0, durationMs: 20, audio })).toThrow();
  });

  it('round trips framed uplink audio', () => {
    const audio = new Uint8Array(640);
    const frame = encodeVoiceUplinkAudioFrame({
      connectionEpoch: 7,
      utteranceId: 'utterance-1',
      audioSeq: 9,
      capturedAtMonotonicMs: 123.5,
      durationMs: 20,
      start: true,
      audio,
    });
    expect(decodeVoiceUplinkAudioFrame(frame)).toEqual({
      connectionEpoch: 7,
      utteranceId: 'utterance-1',
      audioSeq: 9,
      capturedAtMonotonicMs: 123.5,
      durationMs: 20,
      start: true,
      audio,
    });
    expect(() => decodeVoiceAudioFrame(frame)).toThrow();
  });
  it('requires a session key for conversation only', () => {
    expect(createVoiceSessionRequestSchema.safeParse({ purpose: 'dictation', ...negotiation }).success).toBe(true);
    expect(createVoiceSessionRequestSchema.safeParse({ purpose: 'conversation', ...negotiation }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(createVoiceSessionRequestSchema.safeParse({ purpose: 'dictation', provider: 'alibaba', ...negotiation }).success).toBe(false);
    expect(createVoiceSessionRequestSchema.safeParse({ purpose: 'dictation', inputMode: 'manual', ...negotiation }).success).toBe(false);
  });

  it('parses a strict session start message', () => {
    const message = parseVoiceClientMessage({
      protocolVersion: VOICE_REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      type: 'session.start',
      sentAt: Date.now(),
      payload: { sessionId: crypto.randomUUID(), ticket: 'x'.repeat(32) },
    });
    expect(message.type).toBe('session.start');
  });

  it('parses the terminal response event', () => {
    const event = parseVoiceServerEvent({
      protocolVersion: VOICE_REALTIME_PROTOCOL_VERSION,
      eventId: crypto.randomUUID(),
      seq: 8,
      type: 'response.done',
      sentAt: Date.now(),
      sessionId: crypto.randomUUID(),
      payload: { responseId: 'resp_1', finishReason: 'audio_partial', audio: true },
    });

    expect(event.type).toBe('response.done');
  });

  it('accepts PCM playback acknowledgements and rejects invalid byte counts', () => {
    const message = {
      protocolVersion: VOICE_REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      type: 'response.audio.played',
      sentAt: Date.now(),
      payload: { responseId: 'r1', playedDurationMs: 500 },
    };
    expect(parseVoiceClientMessage(message).type).toBe('response.audio.played');
    for (const playedDurationMs of [-2, 0.5, Infinity]) {
      expect(() => parseVoiceClientMessage({ ...message, payload: { responseId: 'r1', playedDurationMs } })).toThrow();
    }
  });
});
