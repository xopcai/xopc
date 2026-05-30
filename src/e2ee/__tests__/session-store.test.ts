import { afterEach, describe, expect, it } from 'vitest';

import {
  consumeRequestSeq,
  createE2eeSession,
  resetE2eeSessionsForTests,
} from '../session-store.js';

describe('e2ee session-store', () => {
  afterEach(() => {
    resetE2eeSessionsForTests();
  });

  it('allows idempotent retry with the same request seq', async () => {
    const devicePub = new Uint8Array(32).fill(1);
    await createE2eeSession({ sessionId: 'sess-a', devicePublicKey: devicePub });

    expect(consumeRequestSeq('sess-a', 1)).not.toBeNull();
    expect(consumeRequestSeq('sess-a', 1)).not.toBeNull();
    expect(consumeRequestSeq('sess-a', 2)).not.toBeNull();
    expect(consumeRequestSeq('sess-a', 2)).not.toBeNull();
    expect(consumeRequestSeq('sess-a', 1)).toBeNull();
    expect(consumeRequestSeq('sess-a', 4)).toBeNull();
  });
});
