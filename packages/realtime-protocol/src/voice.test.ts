import { describe, expect, it } from 'vitest';

import {
  VOICE_REALTIME_PROTOCOL_VERSION,
  createVoiceSessionRequestSchema,
  parseVoiceClientMessage,
  parseVoiceServerEvent,
} from './voice.js';

describe('voice realtime protocol', () => {
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
