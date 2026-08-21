import { describe, expect, it } from 'vitest';

import { RealtimeTicketStore } from '../tickets.js';

describe('RealtimeTicketStore', () => {
  it('binds a one-time ticket to its client', () => {
    const store = new RealtimeTicketStore();
    const issued = store.issue('web-1', 'web', 1_000);

    expect(store.consume(issued.ticket, 'web-1', 'web', 1_001)).toMatchObject({ clientId: 'web-1' });
    expect(store.consume(issued.ticket, 'web-1', 'web', 1_002)).toBeUndefined();
  });

  it('consumes mismatched and expired tickets without allowing reuse', () => {
    const store = new RealtimeTicketStore();
    const mismatched = store.issue('web-1', 'web', 1_000);
    expect(store.consume(mismatched.ticket, 'web-2', 'web', 1_001)).toBeUndefined();
    expect(store.consume(mismatched.ticket, 'web-1', 'web', 1_002)).toBeUndefined();

    const expired = store.issue('web-1', 'web', 1_000);
    expect(store.consume(expired.ticket, 'web-1', 'web', 31_001)).toBeUndefined();
  });
});
