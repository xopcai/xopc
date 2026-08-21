import { describe, expect, it } from 'vitest';

import {
  REALTIME_PROTOCOL_VERSION,
  parseClientRealtimeMessage,
  parseClientRealtimeJsonFrame,
} from './index.js';

describe('realtime protocol', () => {
  it('parses a strict subscription message', () => {
    expect(parseClientRealtimeMessage({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      kind: 'realtime.subscribe',
      sentAt: Date.now(),
      payload: { subscriptions: [{ topic: 'run:r1', afterSeq: 12 }] },
    }).kind).toBe('realtime.subscribe');
  });

  it('rejects unknown fields', () => {
    expect(() => parseClientRealtimeMessage({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      kind: 'realtime.ping',
      sentAt: Date.now(),
      payload: {},
      legacy: true,
    })).toThrow();
  });

  it('enforces the frame size before parsing JSON', () => {
    expect(() => parseClientRealtimeJsonFrame(`"${'x'.repeat(256 * 1024)}"`)).toThrow(/exceeds/);
  });
});
