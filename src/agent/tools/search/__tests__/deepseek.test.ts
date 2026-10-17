import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeepSeekProvider } from '../providers/deepseek.js';
import { deepseekSearchBody, deepseekSearchEndpoint, deepseekSearchResults, readDeepseekResponse } from '../providers/deepseek-protocol.js';
import { SearchProviderRegistry } from '../registry.js';
import { resolveWebSearchConfig } from '../resolve-config.js';

afterEach(() => vi.unstubAllGlobals());
const result = { title: 'Example', url: 'https://example.com/', summary: 'Long summary', snippet: 'Short' };

describe('DeepSeek search', () => {
  it('normalizes the endpoint and validates Unicode without truncation', () => {
    for (const suffix of ['', '/', '/v1', '/v1/']) {
      expect(deepseekSearchEndpoint(`https://proxy.example${suffix}`)).toBe('https://proxy.example/v1/tools/search');
    }
    expect(JSON.parse(deepseekSearchBody('😀'.repeat(128), 100)).count).toBe(50);
    expect(() => deepseekSearchBody('😀'.repeat(129), 5)).toThrow('128');
    expect(() => deepseekSearchBody('   ', 5)).toThrow('128');
    for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?key=secret']) {
      expect(() => deepseekSearchEndpoint(url)).toThrow();
    }
  });

  it('uses summaries, bounds text, and removes unsafe and duplicate URLs', () => {
    expect(deepseekSearchResults({ results: [result, result, { ...result, url: 'javascript:alert(1)' },
      { ...result, url: 'https://example.com/second', summary: '', snippet: 'x'.repeat(900), date: null }] }))
      .toEqual([{ title: 'Example', url: result.url, description: 'Long summary' },
        { title: 'Example', url: 'https://example.com/second', description: 'x'.repeat(800) }]);
    expect(() => deepseekSearchResults({})).toThrow('invalid response');
  });

  it('rejects oversized streamed and malformed responses', async () => {
    await expect(readDeepseekResponse(new Response('x'.repeat(2 * 1024 * 1024 + 1)))).rejects.toThrow('too large');
    await expect(readDeepseekResponse(new Response('invalid'))).rejects.toThrow('invalid JSON');
  });

  it('sends the explicit provider before cloud with Bearer auth and summary-only mode', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ results: [result] }));
    vi.stubGlobal('fetch', fetchImpl);
    const cloud = { name: 'xopc-cloud', isAvailable: () => true, search: vi.fn() };
    const registry = new SearchProviderRegistry({ region: 'cn', maxResults: 5,
      providers: [{ type: 'deepseek', apiKey: 'test-key', url: 'https://proxy.example/v1' }] }, { cloudProvider: cloud });
    await expect(registry.search('site:example.com xopc', 5)).resolves.toMatchObject({ provider: 'deepseek',
      results: [{ title: 'Example', url: 'https://example.com/', description: 'Long summary', source: 'deepseek' }] });
    expect(fetchImpl).toHaveBeenCalledWith('https://proxy.example/v1/tools/search', expect.objectContaining({
      method: 'POST', redirect: 'error', headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
      body: JSON.stringify({ query: 'site:example.com xopc', count: 5, need_content: false }),
    }));
    expect(cloud.search).not.toHaveBeenCalled();
  });

  it('preserves failure fallback and does not bypass authentication refusals', async () => {
    const fallback = { name: 'fallback', isAvailable: () => true, search: vi.fn(async () => []) };
    for (const status of [402, 500]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
      const registry = new SearchProviderRegistry({ region: 'global', maxResults: 5,
        providers: [{ type: 'deepseek', apiKey: 'key' }] }, { fallbackProvider: fallback });
      await expect(registry.search('xopc', 5)).resolves.toMatchObject({ provider: 'fallback' });
    }
    fallback.search.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const registry = new SearchProviderRegistry({ region: 'global', maxResults: 5,
      providers: [{ type: 'deepseek', apiKey: 'key' }] }, { fallbackProvider: fallback });
    await expect(registry.search('xopc', 5)).rejects.toMatchObject({ kind: 'permission_denied' });
    expect(fallback.search).not.toHaveBeenCalled();
  });

  it('does not suppress cloud when an environment key is unresolved or a row is disabled', async () => {
    const cloud = { name: 'xopc-cloud', isAvailable: () => true, search: vi.fn(async () => []) };
    const config = resolveWebSearchConfig({ search: { maxResults: 5, providers: [
      { type: 'deepseek', apiKey: 'XOPC_MISSING_DEEPSEEK_TEST_KEY' }, { type: 'deepseek', apiKey: 'key', disabled: true },
    ] } });
    const registry = new SearchProviderRegistry(config, { cloudProvider: cloud });
    await expect(registry.search('xopc', 5)).resolves.toMatchObject({ provider: 'xopc-cloud' });
  });

  it('aborts before making an upstream request', async () => {
    const fetchImpl = vi.fn(); vi.stubGlobal('fetch', fetchImpl);
    await expect(new DeepSeekProvider('key').search('xopc', 5, AbortSignal.abort())).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
