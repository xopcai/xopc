import { describe, expect, it } from 'vitest';

import {
  REALTIME_CAPABILITIES,
  REALTIME_PROTOCOL_VERSION,
  parseClientRealtimeMessage,
  parseClientRealtimeJsonFrame,
  parseServerRealtimeMessage,
} from './index.js';

describe('realtime protocol', () => {
  it('parses a valid subscription message', () => {
    expect(parseClientRealtimeMessage({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      kind: 'realtime.subscribe',
      sentAt: Date.now(),
      payload: { subscriptions: [{ topic: 'run:r1', afterSeq: 12 }] },
    }).kind).toBe('realtime.subscribe');
  });

  it('ignores unknown fields from newer peers', () => {
    const client = parseClientRealtimeMessage({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      kind: 'realtime.ping',
      sentAt: Date.now(),
      payload: { futurePayloadField: true },
      futureEnvelopeField: true,
    });
    expect(client).not.toHaveProperty('futureEnvelopeField');
    expect(client.payload).not.toHaveProperty('futurePayloadField');

    expect(parseServerRealtimeMessage({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      kind: 'realtime.pong',
      sentAt: Date.now(),
      payload: { futurePayloadField: true },
      futureEnvelopeField: true,
    }).kind).toBe('realtime.pong');
  });

  it('still rejects incompatible versions, kinds, and known field types', () => {
    const base = {
      messageId: crypto.randomUUID(),
      sentAt: Date.now(),
      payload: {},
    };
    expect(() => parseClientRealtimeMessage({ ...base, protocolVersion: 99, kind: 'realtime.ping' })).toThrow();
    expect(() => parseClientRealtimeMessage({ ...base, protocolVersion: REALTIME_PROTOCOL_VERSION, kind: 'future.message' })).toThrow();
    expect(() => parseClientRealtimeMessage({
      ...base,
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      kind: 'realtime.subscribe',
      payload: { subscriptions: [{ topic: 42 }] },
    })).toThrow();
  });

  it('accepts optional capability negotiation fields', () => {
    const message = parseClientRealtimeMessage({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      kind: 'realtime.hello',
      sentAt: Date.now(),
      payload: {
        ticket: 'x'.repeat(32),
        clientId: 'client',
        clientKind: 'web',
        subscriptions: [],
        capabilities: [...REALTIME_CAPABILITIES],
      },
    });
    expect(message.payload.capabilities).toEqual(REALTIME_CAPABILITIES);
  });

  it('enforces the frame size before parsing JSON', () => {
    expect(() => parseClientRealtimeJsonFrame(`"${'x'.repeat(256 * 1024)}"`)).toThrow(/exceeds/);
  });
});
