import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchProviderRegistry } from '../registry.js';
import { SearchError, classifySearchError, searchHttpError } from '../errors.js';
import { withSearchCache, SEARCH_CACHE_TTL_MS, type SearchCacheEntry } from '../cache.js';
import type { SearchProvider, SearchRequest } from '../types.js';

const config = { region: 'global' as const, maxResults: 5, providers: [] };
const hit = (query: string) => [{ title: query, url: `https://example.com/${query}`, description: 'Official source' }];
const requests: SearchRequest[] = [{ id: 'a', query: 'a', count: 5 }, { id: 'b', query: 'b', count: 5 }];
function setup() {
  const primary: SearchProvider = { name: 'primary', isAvailable: () => true, search: vi.fn(async query => hit(query)) };
  const fallback: SearchProvider = { name: 'fallback', isAvailable: () => true, search: vi.fn(async query => hit(query)) };
  const registry = new SearchProviderRegistry(config, { providers: [primary], fallbackProvider: fallback, retryDelayMs: 0, requestTimeoutMs: 100 });
  return { registry, primary, fallback };
}

describe('search error classification and bounded fallback', () => {
  afterEach(() => vi.useRealTimers());
  it('preserves permission, rate-limit and timeout status with Retry-After', () => {
    expect(searchHttpError(new Response(null, { status: 403 })).kind).toBe('permission_denied');
    expect(searchHttpError(new Response(null, { status: 429, headers: { 'Retry-After': '2' } }))).toMatchObject({ kind: 'rate_limited', retryAfterMs: 2000 });
    expect(classifySearchError(new DOMException('expired', 'TimeoutError')).kind).toBe('timeout');
  });
  it('never bypasses a request permission refusal by switching providers or HTML', async () => {
    const { registry, primary, fallback } = setup();
    vi.mocked(primary.search).mockRejectedValueOnce(searchHttpError(new Response(null, { status: 403 })));
    await expect(registry.search('query', 5)).rejects.toMatchObject({ kind: 'permission_denied' });
    expect(primary.search).toHaveBeenCalledOnce();
    expect(fallback.search).not.toHaveBeenCalled();
  });
  it('retries a limited provider once with a bounded backoff', async () => {
    const { registry, primary, fallback } = setup();
    vi.mocked(primary.search).mockRejectedValueOnce(new SearchError({ kind: 'rate_limited', scope: 'request', message: 'Limited', retryAfterMs: 0 }));
    expect((await registry.search('query', 5)).provider).toBe('primary');
    expect(primary.search).toHaveBeenCalledTimes(2);
    expect(fallback.search).not.toHaveBeenCalled();
  });
  it('respects long server cooldowns instead of immediately retrying the same provider', async () => {
    const { registry, primary, fallback } = setup();
    vi.mocked(primary.search).mockRejectedValueOnce(new SearchError({ kind: 'rate_limited', scope: 'request', message: 'Limited', retryAfterMs: 60_000 }));
    expect((await registry.search('query', 5)).provider).toBe('fallback');
    expect(primary.search).toHaveBeenCalledOnce();
    expect(fallback.search).toHaveBeenCalledOnce();
  });
  it('bounds hung requests and aborts their transport before authorized fallback', async () => {
    const { registry, primary, fallback } = setup();
    const signals: AbortSignal[] = [];
    vi.mocked(primary.search).mockImplementation(async (_query, _count, signal) => { signals.push(signal!); return new Promise(() => {}); });
    const result = registry.search('query', 5);
    expect((await result).provider).toBe('fallback');
    expect(signals).toHaveLength(2);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(fallback.search).toHaveBeenCalledOnce();
  });
  it('does not retry cancellation or convert complete failure to an empty successful result', async () => {
    const { registry, primary, fallback } = setup();
    const controller = new AbortController();
    vi.mocked(primary.search).mockImplementation(async () => { controller.abort(); throw controller.signal.reason; });
    await expect(registry.search('query', 5, controller.signal)).rejects.toMatchObject({ kind: 'cancelled' });
    expect(fallback.search).not.toHaveBeenCalled();
    const other = setup();
    vi.mocked(other.primary.search).mockRejectedValue(new Error('Network failed'));
    vi.mocked(other.fallback.search).mockRejectedValue(new Error('HTML failed'));
    await expect(other.registry.search('query', 5)).rejects.toMatchObject({ kind: 'provider_error' });
  });
});

describe('batch search downgrade and reuse', () => {
  afterEach(() => vi.useRealTimers());
  it.each(['unsupported_batch', 'permission_denied', 'rate_limited', 'timeout'] as const)('downgrades a batch-only %s to sequential searches', async kind => {
    const { registry, primary } = setup();
    primary.searchBatch = vi.fn(async () => { throw new SearchError({ kind, scope: 'batch', message: 'Batch unavailable', retryAfterMs: 0 }); });
    let active = 0, maxActive = 0;
    vi.mocked(primary.search).mockImplementation(async query => { maxActive = Math.max(maxActive, ++active); await Promise.resolve(); active--; return hit(query); });
    const results = await registry.searchBatch(requests);
    expect(results.map(result => result.response?.results[0]?.title)).toEqual(['a', 'b']);
    expect(results.every(result => result.fallback === 'individual')).toBe(true);
    expect(maxActive).toBe(1);
    expect(primary.searchBatch).toHaveBeenCalledOnce();
  });
  it('does not downgrade an ambiguous or content-level permission denial', async () => {
    const { registry, primary, fallback } = setup();
    primary.searchBatch = vi.fn(async () => { throw searchHttpError(new Response(null, { status: 403 })); });
    expect((await registry.searchBatch(requests)).every(item => item.error?.kind === 'permission_denied')).toBe(true);
    expect(primary.search).not.toHaveBeenCalled(); expect(fallback.search).not.toHaveBeenCalled();
  });
  it('retains successful batch items and retries only missing or transient failures', async () => {
    const { registry, primary } = setup();
    primary.searchBatch = vi.fn(async () => [{ id: 'a', results: hit('a') }, { id: 'b', error: { kind: 'timeout', scope: 'request', message: 'Slow' } }]);
    await registry.searchBatch(requests);
    expect(primary.search).toHaveBeenCalledTimes(1);
    expect(primary.search).toHaveBeenCalledWith('b', 5, expect.any(AbortSignal));
    const cached = await registry.searchBatch(requests);
    expect(cached.every(item => item.response?.cached)).toBe(true);
    expect(primary.searchBatch).toHaveBeenCalledOnce(); expect(primary.search).toHaveBeenCalledTimes(1);
  });
  it('does not retry a denied individual item alongside successful items', async () => {
    const { registry, primary } = setup();
    primary.searchBatch = vi.fn(async () => [{ id: 'a', results: hit('a') }, { id: 'b', error: { kind: 'permission_denied', scope: 'request', message: 'Query blocked' } }]);
    const result = await registry.searchBatch(requests);
    expect(result[0]?.response?.results).toEqual(hit('a'));
    expect(result[1]?.error?.kind).toBe('permission_denied');
    expect(primary.search).not.toHaveBeenCalled();
  });
  it('deduplicates queries without changing their case, count, order or ids', async () => {
    const { registry, primary } = setup();
    const result = await registry.searchBatch([...requests, { id: 'copy', query: 'a', count: 5 }]);
    expect(primary.search).toHaveBeenCalledTimes(2);
    expect(result.map(item => item.id)).toEqual(['a', 'b', 'copy']);
    expect(result[2]?.response?.results).toEqual(hit('a'));
  });
  it('rechecks authorization before serving cached results and between individual fallbacks', async () => {
    const { registry, primary } = setup();
    await registry.search('a', 5);
    const refused = () => { throw new SearchError({ kind: 'permission_denied', scope: 'request', message: 'Revoked' }); };
    await expect(registry.search('a', 5, undefined, refused)).rejects.toMatchObject({ kind: 'permission_denied' });
    const controller = new AbortController();
    primary.searchBatch = vi.fn(async () => { controller.abort(); throw controller.signal.reason; });
    const result = await registry.searchBatch([{ id: 'b', query: 'b', count: 5 }, { id: 'c', query: 'c', count: 5 }], controller.signal);
    expect(result.every(item => item.error?.kind === 'cancelled')).toBe(true);
    expect(primary.search).toHaveBeenCalledOnce();
  });
  it('shares only explicitly scoped cache entries and invalidates TTL/config/count changes', async () => {
    vi.useFakeTimers();
    const entries = new Map<string, SearchCacheEntry>();
    const cache = { get: (key: string) => entries.get(key), set: (entry: SearchCacheEntry) => { entries.set(entry.key, entry); } };
    const provider: SearchProvider = { name: 'primary', isAvailable: () => true, search: vi.fn(async query => hit(query)) };
    const make = () => new SearchProviderRegistry(config, { providers: [provider], fallbackProvider: null });
    await withSearchCache(cache, () => make().search('a', 5));
    expect((await withSearchCache(cache, () => make().search('a', 5))).cached).toBe(true);
    await make().search('a', 5); // No shared cache outside this research scope.
    await withSearchCache(cache, () => make().search('a', 6));
    await vi.advanceTimersByTimeAsync(SEARCH_CACHE_TTL_MS);
    await withSearchCache(cache, () => make().search('a', 5));
    expect(provider.search).toHaveBeenCalledTimes(4);
  });
});

it('treats legacy HTTP refusals and explicit permission messages conservatively', () => {
  expect(classifySearchError(new Error('HTTP 403: denied')).kind).toBe('permission_denied');
  expect(classifySearchError(new Error('Permission denied')).kind).toBe('permission_denied');
  expect(classifySearchError(Object.assign(new Error('Policy refused'), { code: 'EACCES' })).kind).toBe('permission_denied');
});

it('does not repeat a completed provider request when persisting its cache fails', async () => {
  const provider: SearchProvider = { name: 'primary', isAvailable: () => true, search: vi.fn(async query => hit(query)) };
  const fallback: SearchProvider = { name: 'fallback', isAvailable: () => true, search: vi.fn(async query => hit(query)) };
  const registry = new SearchProviderRegistry(config, { providers: [provider], fallbackProvider: fallback,
    cache: { get: () => undefined, set: () => { throw new Error('Storage unavailable'); } } });
  await expect(registry.search('a', 5)).rejects.toThrow('checkpoint could not be saved');
  expect(provider.search).toHaveBeenCalledOnce(); expect(fallback.search).not.toHaveBeenCalled();
});

it('does not hammer a provider with later queries during its declared cooldown', async () => {
  const { registry, primary } = setup();
  vi.mocked(primary.search).mockRejectedValueOnce(new SearchError({ kind: 'rate_limited', scope: 'request', message: 'Limited', retryAfterMs: 60_000 }));
  expect((await registry.searchBatch(requests)).every(item => item.response?.provider === 'fallback')).toBe(true);
  expect(primary.search).toHaveBeenCalledOnce();
});

it('stops further queries after a provider-wide permission refusal', async () => {
  const { registry, primary, fallback } = setup();
  vi.mocked(primary.search).mockRejectedValue(searchHttpError(new Response(null, { status: 401 })));
  expect((await registry.searchBatch(requests)).every(item => item.error?.kind === 'permission_denied')).toBe(true);
  expect(primary.search).toHaveBeenCalledOnce(); expect(fallback.search).not.toHaveBeenCalled();
});

it('invalidates cached queries when provider identity or region changes', async () => {
  const entries = new Map<string, SearchCacheEntry>();
  const cache = { get: (key: string) => entries.get(key), set: (entry: SearchCacheEntry) => { entries.set(entry.key, entry); } };
  let identity = 'endpoint-a';
  const provider: SearchProvider = { name: 'primary', isAvailable: () => true, cacheIdentity: () => identity, search: vi.fn(async query => hit(query)) };
  const make = (region: 'cn' | 'global' = 'global') => new SearchProviderRegistry({ ...config, region }, { providers: [provider], fallbackProvider: null, cache });
  await make().search('a', 5);
  expect((await make().search('a', 5)).cached).toBe(true);
  identity = 'endpoint-b'; await make().search('a', 5);
  await make('cn').search('a', 5);
  expect(provider.search).toHaveBeenCalledTimes(3);
});
