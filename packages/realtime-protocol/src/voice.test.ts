import { describe, expect, it } from 'vitest';

import {
  VOICE_REALTIME_PROTOCOL_VERSION,
  createVoiceSessionRequestSchema,
  parseVoiceClientMessage,
  parseVoiceServerEvent,
  encodeVoiceAudioFrame,
  decodeVoiceAudioFrame,
} from './voice.js';

describe('voice realtime protocol', () => {
  it('accepts the configured conversation engine and rejects overrides for dictation', () => {
    expect(createVoiceSessionRequestSchema.safeParse({ purpose: 'conversation', sessionKey: 'test' }).success).toBe(true);
    for (const engine of ['agent', 'omni']) {
      expect(createVoiceSessionRequestSchema.safeParse({ purpose: 'conversation', sessionKey: 'test', engine }).success).toBe(true);
      expect(createVoiceSessionRequestSchema.safeParse({ purpose: 'dictation', engine }).success).toBe(false);
    }
  });

  it('round trips tagged audio and rejects old or malformed frames', () => {
    const audio = new Uint8Array([1, 2, 3, 4]);
    const frame = encodeVoiceAudioFrame({ responseId: 'response-1', seq: 3, audio });
    expect(decodeVoiceAudioFrame(frame)).toEqual({ responseId: 'response-1', seq: 3, audio });
    expect(() => decodeVoiceAudioFrame(audio)).toThrow();
    expect(() => decodeVoiceAudioFrame(frame.subarray(0, frame.length - 1))).toThrow();
    frame[0] = 0;
    expect(() => decodeVoiceAudioFrame(frame)).toThrow();
    expect(() => encodeVoiceAudioFrame({ responseId: 'x', seq: 0, audio })).toThrow();
  });
  it('requires a session key for conversation only', () => {
    expect(createVoiceSessionRequestSchema.safeParse({ purpose: 'dictation' }).success).toBe(true);
    expect(createVoiceSessionRequestSchema.safeParse({ purpose: 'conversation' }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(createVoiceSessionRequestSchema.safeParse({ purpose: 'dictation', provider: 'alibaba' }).success).toBe(false);
    expect(createVoiceSessionRequestSchema.safeParse({ purpose: 'dictation', inputMode: 'manual' }).success).toBe(false);
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
      payload: { responseId: 'r1', playedBytes: 24_000 },
    };
    expect(parseVoiceClientMessage(message).type).toBe('response.audio.played');
    for (const playedBytes of [-2, 1, 0.5, Infinity]) {
      expect(() => parseVoiceClientMessage({ ...message, payload: { responseId: 'r1', playedBytes } })).toThrow();
    }
  });
});
