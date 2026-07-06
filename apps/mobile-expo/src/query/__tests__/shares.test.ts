import { describe, expect, it, vi } from 'vitest';

// Avoid pulling react-native through the gateway-store import chain.
vi.mock('../../stores/gateway-store', () => ({
  useGatewayStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({ token: '', activeGatewayId: null })),
  }),
}));
vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  notifyUnauthorizedIfNeeded: vi.fn(),
  formatApiHttpError: vi.fn(),
}));

import { thumbnailUrlWithCacheBust } from '../shares';

describe('thumbnailUrlWithCacheBust', () => {
  it('returns undefined when url is empty', () => {
    expect(thumbnailUrlWithCacheBust(undefined, 'ready')).toBeUndefined();
  });

  it('passes URL through unchanged when not ready', () => {
    expect(thumbnailUrlWithCacheBust('https://x/t', 'pending')).toBe('https://x/t');
    expect(thumbnailUrlWithCacheBust('https://x/t', 'unknown')).toBe('https://x/t');
    expect(thumbnailUrlWithCacheBust('https://x/t', 'gone')).toBe('https://x/t');
    expect(thumbnailUrlWithCacheBust('https://x/t', 'unavailable')).toBe('https://x/t');
  });

  it('appends a stable cache-bust suffix on ready (no query)', () => {
    expect(thumbnailUrlWithCacheBust('https://x/t', 'ready')).toBe('https://x/t?_=ready');
  });

  it('appends with & when url already has a query', () => {
    expect(thumbnailUrlWithCacheBust('https://x/t?v=1', 'ready')).toBe('https://x/t?v=1&_=ready');
  });

  it('cache-bust is stable (does not change between calls)', () => {
    const a = thumbnailUrlWithCacheBust('https://x/t', 'ready');
    const b = thumbnailUrlWithCacheBust('https://x/t', 'ready');
    expect(a).toBe(b);
  });
});
