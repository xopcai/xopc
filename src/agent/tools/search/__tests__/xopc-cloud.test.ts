import { describe, expect, it, vi } from 'vitest';

import type { CatalogSource } from '../../../../providers/model-catalog-store.js';
import { XopcCloudSearchProvider } from '../providers/xopc-cloud.js';

function source(search = true): CatalogSource {
  return {
    providerId: 'xopc-cloud',
    baseUrl: 'https://router.test/v1',
    api: 'openai-completions',
    etag: 'catalog-1',
    recommendedModel: null,
    ...(search ? {
      search: {
        schemaVersion: 1,
        endpoint: '/search',
        auth: { scope: 'models:invoke' },
        maxResults: 10,
        defaults: { count: 5, safeSearch: 'moderate' },
        capabilities: { freshness: true, language: true, region: true },
      },
    } : {}),
    lastSuccessAt: 1,
    models: [],
  };
}

describe('XopcCloudSearchProvider', () => {
  it('uses the discovered endpoint and OAuth credential', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(input).toBe('https://router.test/v1/search');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer oauth-token');
      expect(JSON.parse(String(init?.body))).toEqual({ query: 'xopc', count: 10, region: 'cn' });
      return Response.json({ results: [{ title: 'XOPC', url: 'https://xopc.ai', description: 'AI' }] });
    });
    const provider = new XopcCloudSearchProvider({
      region: 'cn',
      fetchImpl,
      catalogStore: { getSource: () => source() },
      credentials: { resolveApiKey: async () => 'oauth-token' },
    });

    expect(provider.isAvailable()).toBe(true);
    await expect(provider.search('xopc', 20)).resolves.toEqual([{
      title: 'XOPC', url: 'https://xopc.ai', description: 'AI', source: 'xopc-cloud',
    }]);
  });

  it('is unavailable when the catalog does not advertise search', () => {
    const provider = new XopcCloudSearchProvider({
      region: 'global',
      catalogStore: { getSource: () => source(false) },
      credentials: { resolveApiKey: async () => null },
    });
    expect(provider.isAvailable()).toBe(false);
  });

  it('rejects invalid and failed cloud responses so the registry can fall back', async () => {
    const provider = new XopcCloudSearchProvider({
      region: 'global',
      fetchImpl: async () => Response.json({ error: { message: 'quota exceeded' } }, { status: 429 }),
      catalogStore: { getSource: () => source() },
      credentials: { resolveApiKey: async () => 'token' },
    });
    await expect(provider.search('xopc', 5)).rejects.toThrow('quota exceeded');
  });

  it('carries actual upstream and sanitized fallback trace without changing result sources', async () => {
    const provider = new XopcCloudSearchProvider({ region: 'cn', catalogStore: { getSource: () => source() },
      credentials: { resolveApiKey: async () => 'token' }, fetchImpl: async () => Response.json({
        results: [{ title: 'Result', url: 'https://example.com', description: 'Summary' }],
        trace: [{ provider: 'deepseek', outcome: 'skipped', reason: 'unsupported_request', apiKey: 'secret' },
          { provider: 'tavily', outcome: 'success' }, { provider: 'bad value', outcome: 'error' }],
      }, { headers: { 'x-xopc-search-upstream': 'tavily', 'x-xopc-provider-attempts': '2' } }),
    });
    const result = await provider.searchWithMetadata('query', 3);
    expect(result.results[0]?.source).toBe('xopc-cloud');
    expect(result.metadata).toEqual({ upstream: 'tavily', attemptCount: 2, attempts: [
      { provider: 'xopc-cloud', upstream: 'deepseek', outcome: 'skipped', reason: 'unsupported_request' },
      { provider: 'xopc-cloud', upstream: 'tavily', outcome: 'success' },
    ] });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('supports previously deployed cloud headers without inventing a missing route', async () => {
    const provider = new XopcCloudSearchProvider({ region: 'global', catalogStore: { getSource: () => source() },
      credentials: { resolveApiKey: async () => 'token' }, fetchImpl: async () => Response.json({ results: [] }, {
        headers: { 'x-xopc-search-upstream': 'deepseek', 'x-xopc-provider-attempts': '1' },
      }),
    });
    expect((await provider.searchWithMetadata('query', 3)).metadata).toEqual({ upstream: 'deepseek', attemptCount: 1 });
  });
});
