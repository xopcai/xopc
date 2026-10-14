import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebSearchTool } from '../web.js';
import { createDataBatchTool, withDataToolPermissions } from '../dataBatch.js';
import { acquireData } from '../../data-acquisition/service.js';
import { withSearchCache, type SearchCacheEntry } from '../search/cache.js';
import type { Config } from '../../../config/schema.js';

const getConfig = () => ({ tools: { web: { search: { region: 'global', providers: [{ type: 'brave', apiKey: 'test' }] } } } }) as unknown as Config;
const operations = [{ id: 'a', kind: 'web_search' as const, query: 'Vendor A official price', count: 5 },
  { id: 'b', kind: 'web_search' as const, query: 'Vendor B official price', count: 5 }];
const allowed = new Set(['web_search']);

describe('web_search and data_batch search integration', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('executes authorized singles in sequence and reuses results across later batches and single calls', async () => {
    const fetch = vi.fn(async (input: any) => {
      const query = new URL(input).searchParams.get('q')!;
      return Response.json({ web: { results: [{ title: query, url: 'https://example.com/pricing', description: 'Contact sales' }] } });
    });
    vi.stubGlobal('fetch', fetch);
    const search = createWebSearchTool(getConfig);
    const entries = new Map<string, SearchCacheEntry>();
    const cache = { get: (key: string) => entries.get(key), set: (entry: SearchCacheEntry) => { entries.set(entry.key, entry); } };
    const options = { getTools: () => [search] };
    const first = await withSearchCache(cache, () => acquireData('/tmp', { operations }, allowed, undefined, options));
    expect(first.operations.map(item => item.status)).toEqual(['ok', 'ok']);
    expect(first.sourceRequests).toBe(2);
    const second = await withSearchCache(cache, () => acquireData('/tmp', { operations }, allowed, undefined, options));
    expect(second.operations.every(item => item.cached)).toBe(true);
    expect(second.sourceRequests).toBe(0);
    expect(second.fragments.map(item => item.source.capturedAt)).toEqual(first.fragments.map(item => item.source.capturedAt));
    expect((await withSearchCache(cache, () => search.execute('single', { query: operations[0]!.query, count: 5 }))).details).toMatchObject({ cached: true, sourceRequests: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('keeps successful query output beside a typed permission refusal without HTML bypass', async () => {
    const fetch = vi.fn(async (input: any) => new URL(input).searchParams.get('q')!.includes('Vendor A')
      ? Response.json({ web: { results: [{ title: 'A', url: 'https://example.com/a', description: 'Official' }] } })
      : new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    const search = createWebSearchTool(getConfig);
    const result = await acquireData('/tmp', { operations }, allowed, undefined, { getTools: () => [search] });
    expect(result.operations[0]?.status).toBe('ok');
    expect(result.operations[1]).toMatchObject({ status: 'denied', failureKind: 'permission_denied' });
    expect(result.fragments).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([url]) => String(url).startsWith('https://api.search.brave.com/'))).toBe(true);
  });
  it('honors active tool restrictions before invoking the batch optimization', async () => {
    const search = createWebSearchTool(getConfig);
    const optimized = vi.spyOn(search, 'executeSearchBatch');
    const batch = createDataBatchTool('/tmp', () => allowed, { getTools: () => [search] });
    const result = await withDataToolPermissions(new Set(), () => batch.execute('batch', { operations }));
    expect(result.details).toMatchObject({ status: 'failed', sourceRequests: 0 });
    expect(optimized).not.toHaveBeenCalled();
  });
  it('rechecks revoked permissions between individual requests and never serves cached data after denial', async () => {
    let permitted = true;
    const fetch = vi.fn(async () => {
      permitted = false;
      return Response.json({ web: { results: [{ title: 'A', url: 'https://example.com/a', description: 'Official' }] } });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await acquireData('/tmp', { operations }, allowed, undefined, {
      getTools: () => [createWebSearchTool(getConfig)], canExecute: () => permitted,
    });
    expect(result.operations.every(item => item.status === 'denied')).toBe(true);
    expect(result.fragments).toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('reports rate-limit failures as failures rather than successful empty searches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } })));
    const result = await createWebSearchTool(getConfig).execute('search', { query: 'Official pricing' });
    expect(result.details).toMatchObject({ status: 'failed', failure: { kind: 'rate_limited', retryAfterMs: 60_000 } });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('rate_limited') });
  });
});
