import { describe, expect, it } from 'vitest';

import {
  getAsyncLogContext,
  runWithLogContext,
  updateAsyncLogContext,
} from '../context.js';

describe('async log context (AsyncLocalStorage)', () => {
  it('exposes context inside runWithLogContext', () => {
    runWithLogContext({ requestId: 'req-a', sessionId: 'sess-1' }, () => {
      expect(getAsyncLogContext()).toEqual(
        expect.objectContaining({ requestId: 'req-a', sessionId: 'sess-1' }),
      );
    });
    expect(getAsyncLogContext()).toBeUndefined();
  });

  it('merges nested runWithLogContext over parent', () => {
    runWithLogContext({ requestId: 'outer', sessionId: 's1' }, () => {
      runWithLogContext({ sessionId: 's2', userId: 'u1' }, () => {
        const ctx = getAsyncLogContext();
        expect(ctx?.requestId).toBe('outer');
        expect(ctx?.sessionId).toBe('s2');
        expect(ctx?.userId).toBe('u1');
      });
    });
  });

  it('updateAsyncLogContext mutates current store', async () => {
    await runWithLogContext({ requestId: 'r1' }, async () => {
      expect(getAsyncLogContext()?.sessionId).toBeUndefined();
      updateAsyncLogContext({ sessionId: 'from-body' });
      expect(getAsyncLogContext()?.sessionId).toBe('from-body');
    });
  });

  it('propagates through async continuation', async () => {
    await runWithLogContext({ requestId: 'async-req' }, async () => {
      await Promise.resolve();
      expect(getAsyncLogContext()?.requestId).toBe('async-req');
    });
  });

  it('updateAsyncLogContext is no-op outside runWithLogContext', () => {
    updateAsyncLogContext({ sessionId: 'orphan' });
    expect(getAsyncLogContext()).toBeUndefined();
  });
});
