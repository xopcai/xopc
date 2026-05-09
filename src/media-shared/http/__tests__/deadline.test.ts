import { describe, expect, it, vi } from 'vitest';

import {
  TimeoutAbortError,
  isTimeoutAbortError,
  pickEffectiveTimeoutMs,
  resolveDeadline,
} from '../deadline.js';

describe('pickEffectiveTimeoutMs', () => {
  it('returns undefined when neither input is provided', () => {
    expect(pickEffectiveTimeoutMs({})).toBeUndefined();
  });

  it('ignores non-positive / non-finite values', () => {
    expect(pickEffectiveTimeoutMs({ timeoutMs: 0 })).toBeUndefined();
    expect(pickEffectiveTimeoutMs({ timeoutMs: -100, providerDefaultMs: Number.NaN })).toBeUndefined();
    expect(pickEffectiveTimeoutMs({ providerDefaultMs: Number.POSITIVE_INFINITY })).toBeUndefined();
  });

  it('picks the smaller of the two when both are positive', () => {
    expect(pickEffectiveTimeoutMs({ timeoutMs: 5000, providerDefaultMs: 30_000 })).toBe(5000);
    expect(pickEffectiveTimeoutMs({ timeoutMs: 60_000, providerDefaultMs: 30_000 })).toBe(30_000);
  });

  it('falls through when only one is provided', () => {
    expect(pickEffectiveTimeoutMs({ timeoutMs: 5000 })).toBe(5000);
    expect(pickEffectiveTimeoutMs({ providerDefaultMs: 30_000 })).toBe(30_000);
  });
});

describe('resolveDeadline', () => {
  it('aborts with TimeoutAbortError when timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      const deadline = resolveDeadline({ timeoutMs: 500 });
      expect(deadline.signal.aborted).toBe(false);
      vi.advanceTimersByTime(500);
      expect(deadline.signal.aborted).toBe(true);
      expect(isTimeoutAbortError(deadline.signal.reason)).toBe(true);
      expect((deadline.signal.reason as TimeoutAbortError).timeoutMs).toBe(500);
      deadline.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates upstream abort', () => {
    const upstream = new AbortController();
    const deadline = resolveDeadline({ signal: upstream.signal });
    expect(deadline.signal.aborted).toBe(false);
    upstream.abort(new Error('cancelled'));
    expect(deadline.signal.aborted).toBe(true);
    deadline.cleanup();
  });

  it('honours an already-aborted upstream signal', () => {
    const upstream = new AbortController();
    upstream.abort(new Error('already gone'));
    const deadline = resolveDeadline({ signal: upstream.signal });
    expect(deadline.signal.aborted).toBe(true);
    deadline.cleanup();
  });

  it('cleanup detaches the timer so signal stays unaborted afterwards', async () => {
    vi.useFakeTimers();
    try {
      const deadline = resolveDeadline({ timeoutMs: 1000 });
      deadline.cleanup();
      vi.advanceTimersByTime(2000);
      expect(deadline.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
