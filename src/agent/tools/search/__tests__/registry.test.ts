import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SearchProviderRegistry } from '../registry.js';
import type { SearchProvider } from '../types.js';

describe('SearchProviderRegistry', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        `<html><body><a class="result__a" href="https://example.com/r">Hit</a>` +
          `<a class="result__snippet">Desc</a></body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } },
      ),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses HTML fallback when no API providers', async () => {
    const reg = new SearchProviderRegistry({
      region: 'global',
      apiKey: '',
      maxResults: 5,
      providers: [],
    });
    expect(reg.hasConfiguredApiProvider()).toBe(false);
    const { results, provider } = await reg.search('query', 3);
    expect(provider).toBe('duckduckgo-html');
    expect(results.length).toBeGreaterThan(0);
  });

  it('reports configured provider when tavily key present', () => {
    const reg = new SearchProviderRegistry({
      region: 'global',
      apiKey: '',
      maxResults: 5,
      providers: [{ type: 'tavily', apiKey: 'tvly-test-key' }],
    });
    expect(reg.hasConfiguredApiProvider()).toBe(true);
  });

  it('uses cloud automatically only when no provider was configured manually', async () => {
    const cloud: SearchProvider = {
      name: 'xopc-cloud',
      isAvailable: () => true,
      search: vi.fn(async () => [{ title: 'Cloud', url: 'https://xopc.ai', description: 'Result' }]),
    };
    const automatic = new SearchProviderRegistry({
      region: 'global',
      maxResults: 5,
      providers: [],
    }, { cloudProvider: cloud });
    await expect(automatic.search('query', 3)).resolves.toMatchObject({ provider: 'xopc-cloud' });
    expect(cloud.search).toHaveBeenCalledOnce();

    const explicit = new SearchProviderRegistry({
      region: 'global',
      maxResults: 5,
      providers: [{ type: 'tavily', apiKey: 'manual-key' }],
    }, { cloudProvider: cloud });
    await explicit.search('query', 3);
    expect(cloud.search).toHaveBeenCalledOnce();
  });

  it('does not let incomplete or disabled manual rows suppress cloud search', async () => {
    const cloud: SearchProvider = {
      name: 'xopc-cloud',
      isAvailable: () => true,
      search: vi.fn(async () => [{ title: 'Cloud', url: 'https://xopc.ai', description: 'Result' }]),
    };
    const registry = new SearchProviderRegistry({
      region: 'global',
      maxResults: 5,
      providers: [
        { type: 'brave', apiKey: '' },
        { type: 'searxng', url: '  ' },
        { type: 'tavily', apiKey: 'configured-but-disabled', disabled: true },
      ],
    }, { cloudProvider: cloud });

    await expect(registry.search('query', 3)).resolves.toMatchObject({ provider: 'xopc-cloud' });
    expect(cloud.search).toHaveBeenCalledOnce();
  });
});
