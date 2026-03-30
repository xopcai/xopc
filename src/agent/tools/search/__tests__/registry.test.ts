import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SearchProviderRegistry } from '../registry.js';

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
});
