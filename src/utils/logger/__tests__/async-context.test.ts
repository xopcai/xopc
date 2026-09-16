import { describe, expect, it } from 'vitest';

import {
  getAsyncLogContext,
  inboundCorrelationMetadataFromAsyncLogContext,
  runWithLogContext,
  updateAsyncLogContext,
} from '../context.js';

describe('async log context (AsyncLocalStorage)', () => {
  it('exposes context inside runWithLogContext', () => {
    runWithLogContext({ requestId: 'req-a', transcriptId: 'sess-1' }, () => {
      expect(getAsyncLogContext()).toEqual(
        expect.objectContaining({ requestId: 'req-a', transcriptId: 'sess-1' }),
      );
    });
    expect(getAsyncLogContext()).toBeUndefined();
  });

  it('merges nested runWithLogContext over parent', () => {
    runWithLogContext({ requestId: 'outer', transcriptId: 's1' }, () => {
      runWithLogContext({ transcriptId: 's2', userId: 'u1' }, () => {
        const ctx = getAsyncLogContext();
        expect(ctx?.requestId).toBe('outer');
        expect(ctx?.transcriptId).toBe('s2');
        expect(ctx?.userId).toBe('u1');
      });
    });
  });

  it('updateAsyncLogContext mutates current store', async () => {
    await runWithLogContext({ requestId: 'r1' }, async () => {
      expect(getAsyncLogContext()?.transcriptId).toBeUndefined();
      updateAsyncLogContext({ transcriptId: 'from-body' });
      expect(getAsyncLogContext()?.transcriptId).toBe('from-body');
    });
  });

  it('propagates through async continuation', async () => {
    await runWithLogContext({ requestId: 'async-req' }, async () => {
      await Promise.resolve();
      expect(getAsyncLogContext()?.requestId).toBe('async-req');
    });
  });

  it('updateAsyncLogContext is no-op outside runWithLogContext', () => {
    updateAsyncLogContext({ transcriptId: 'orphan' });
    expect(getAsyncLogContext()).toBeUndefined();
  });

  it('inboundCorrelationMetadataFromAsyncLogContext copies safe keys only', () => {
    expect(inboundCorrelationMetadataFromAsyncLogContext()).toBeUndefined();
    runWithLogContext(
      {
        requestId: 'req-x',
        transcriptId: 'should-not-propagate',
        correlationId: 'corr-1',
        userId: 'u-9',
      },
      () => {
        expect(inboundCorrelationMetadataFromAsyncLogContext()).toEqual({
          requestId: 'req-x',
          correlationId: 'corr-1',
          userId: 'u-9',
        });
      },
    );
  });
});
