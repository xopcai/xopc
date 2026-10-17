import { describe, expect, it, vi } from 'vitest';

import { SearchProviderRegistry } from '../registry.js';
import { createWebSearchTool } from '../../web.js';
import { withSearchCache, type SearchCacheEntry } from '../cache.js';
import { sanitizeSearchInfo } from '../search-info.js';

describe('search provenance', () => {
  it('records actual failed providers and preserves original provenance on cached and batch reads', async () => {
    const primary = { name: 'deepseek', isAvailable: () => true, search: vi.fn(async () => { throw new Error('upstream unavailable'); }) };
    const cloud = { name: 'xopc-cloud', isAvailable: () => true, search: vi.fn(), searchWithMetadata: vi.fn(async () => ({
      results: [{ title: 'Result', url: 'https://example.com', description: 'Summary', source: 'xopc-cloud' }],
      metadata: { upstream: 'tavily', attemptCount: 2, attempts: [
        { provider: 'xopc-cloud', upstream: 'deepseek', outcome: 'error' as const, reason: 'timeout' },
        { provider: 'xopc-cloud', upstream: 'tavily', outcome: 'success' as const },
      ] },
    })) };
    const entries = new Map<string, SearchCacheEntry>();
    const registry = new SearchProviderRegistry({ region: 'cn', maxResults: 3, providers: [] }, { providers: [primary, cloud], fallbackProvider: null,
      cache: { get: key => entries.get(key), set: entry => { entries.set(entry.key, entry); } } });
    const first = await registry.search('query', 3);
    expect(first.metadata).toEqual({ upstream: 'tavily', attemptCount: 3, attempts: [
      { provider: 'deepseek', outcome: 'error', reason: 'provider_error' },
      { provider: 'xopc-cloud', upstream: 'deepseek', outcome: 'error', reason: 'timeout' },
      { provider: 'xopc-cloud', upstream: 'tavily', outcome: 'success' },
    ] });
    first.metadata!.upstream = 'mutated';
    const hit = await registry.search('query', 3);
    expect(hit).toMatchObject({ provider: 'xopc-cloud', cached: true, metadata: { upstream: 'tavily', attemptCount: 3 } });
    expect(hit.capturedAt).toBe(first.capturedAt);
    expect((await registry.searchBatch([{ id: 'one', query: 'query', count: 3 }]))[0]?.response).toMatchObject({ cached: true, metadata: hit.metadata });
    expect(primary.search).toHaveBeenCalledOnce(); expect(cloud.searchWithMetadata).toHaveBeenCalledOnce();
  });

  it('emits compact provider information in tool details and marks task-scoped cache hits', async () => {
    const fetch = vi.fn(async () => Response.json({ web: { results: [{ title: 'Result', url: 'https://example.com', description: 'Summary' }] } }));
    vi.stubGlobal('fetch', fetch);
    const entries = new Map<string, SearchCacheEntry>();
    const cache = { get: (key: string) => entries.get(key), set: (entry: SearchCacheEntry) => { entries.set(entry.key, entry); } };
    const tool = createWebSearchTool(() => ({ tools: { web: { search: { providers: [{ type: 'brave', apiKey: 'test' }], maxResults: 3 } } } }) as never);
    try {
      const first = await withSearchCache(cache, () => tool.execute('one', { query: 'query', count: 3 }));
      const hit = await withSearchCache(cache, () => tool.execute('two', { query: 'query', count: 3 }));
      expect(first.details.searchInfo).toMatchObject({ provider: 'brave', cached: false, attemptCount: 1 });
      expect(hit.details.searchInfo).toMatchObject({ provider: 'brave', cached: true, capturedAt: first.details.searchInfo.capturedAt });
      expect(fetch).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });

  it('bounds persisted metadata and drops query, results, keys and arbitrary error messages', () => {
    const info = sanitizeSearchInfo({ provider: 'xopc-cloud', upstream: 'deepseek', cached: true, capturedAt: 123, attemptCount: 2,
      query: 'private query', apiKey: 'secret', attempts: Array.from({ length: 99 }, () => ({ provider: 'xopc-cloud', upstream: 'deepseek',
        outcome: 'error', reason: 'error message with secrets', apiKey: 'secret' })) });
    expect(info?.attempts).toHaveLength(24);
    expect(info?.upstream).toBe('deepseek');
    expect(JSON.stringify(info)).not.toMatch(/secret|private|error message/);
  });
});
