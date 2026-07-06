import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../api/client', () => ({
  apiFetch: vi.fn(),
  notifyUnauthorizedIfNeeded: vi.fn(),
  formatApiHttpError: vi.fn(),
}));

// We mock the underlying API call so the cache layer is exercised in isolation.
vi.mock('../../../api/share', () => ({
  createAutoShare: vi.fn(),
}));

import { createAutoShare } from '../../../api/share';
import {
  consumePrefetchedShare,
  prefetchShare,
  resetShareprefetchCacheForTests,
} from '../share-prefetch';

const mockedCreate = vi.mocked(createAutoShare);

beforeEach(() => {
  resetShareprefetchCacheForTests();
  mockedCreate.mockReset();
  // Default to a resolved sentinel so tests that don't care about the payload
  // don't crash inside prefetch's `.catch()` sink.
  mockedCreate.mockResolvedValue({} as unknown as Awaited<ReturnType<typeof createAutoShare>>);
});

afterEach(() => {
  resetShareprefetchCacheForTests();
});

describe('prefetchShare / consumePrefetchedShare', () => {
  it('returns null when nothing was prefetched', () => {
    expect(consumePrefetchedShare({ path: 'a.html' })).toBeNull();
  });

  it('returns the prefetched promise on consume', async () => {
    const payload = { ok: true } as unknown as Awaited<ReturnType<typeof createAutoShare>>;
    mockedCreate.mockResolvedValue(payload);

    prefetchShare({ path: 'a.html' });
    const p = consumePrefetchedShare({ path: 'a.html' });
    expect(p).not.toBeNull();
    await expect(p).resolves.toBe(payload);
  });

  it('fires createAutoShare exactly once on prefetch (idempotent)', () => {
    prefetchShare({ path: 'a.html', audience: 'friend' });
    prefetchShare({ path: 'a.html', audience: 'friend' });
    prefetchShare({ path: 'a.html', audience: 'friend' });
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it('different request keys cache independently', () => {
    prefetchShare({ path: 'a.html' });
    prefetchShare({ path: 'b.html' });
    expect(mockedCreate).toHaveBeenCalledTimes(2);
    expect(consumePrefetchedShare({ path: 'a.html' })).not.toBeNull();
    expect(consumePrefetchedShare({ path: 'b.html' })).not.toBeNull();
  });

  it('consume removes the entry — a second consume returns null', () => {
    mockedCreate.mockResolvedValue({} as unknown as Awaited<ReturnType<typeof createAutoShare>>);
    prefetchShare({ path: 'a.html' });
    expect(consumePrefetchedShare({ path: 'a.html' })).not.toBeNull();
    expect(consumePrefetchedShare({ path: 'a.html' })).toBeNull();
  });

  it('swallows rejection of an unattached prefetch (no unhandled rejection)', async () => {
    // If this leaks, the test runner will fail with an unhandled-rejection.
    mockedCreate.mockRejectedValue(new Error('server down'));
    prefetchShare({ path: 'a.html' });
    // Yield to the microtask queue so the rejection propagates.
    await Promise.resolve();
    await Promise.resolve();
    // If a consumer DOES await, they still see the error.
    const p = consumePrefetchedShare({ path: 'a.html' });
    if (p) await expect(p).rejects.toThrow('server down');
  });
});
