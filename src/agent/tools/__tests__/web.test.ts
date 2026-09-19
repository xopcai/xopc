import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('undici', async importOriginal => ({
  ...await importOriginal<typeof import('undici')>(),
  fetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args),
}));

import { createWebFetchTool } from '../web.js';

describe('createWebFetchTool', () => {
  it('rejects redirects to internal addresses before fetching the target', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
    vi.stubGlobal('fetch', fetch);
    const result = await createWebFetchTool(() => undefined).execute('redirect', { url: 'https://example.com' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({ error: expect.stringContaining('Blocked') });
  });

  it('rejects oversized bodies while streaming and reports truncation explicitly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(6_000_001))));
    expect((await createWebFetchTool(() => undefined).execute('large', { url: 'https://example.com' })).details).toMatchObject({ error: 'Response too large' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('a'.repeat(200), { headers: { 'content-type': 'text/plain' } })));
    expect((await createWebFetchTool(() => undefined).execute('small', { url: 'https://example.com', maxChars: 100 })).details).toMatchObject({ truncated: true, complete: false });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts readable article text with the lightweight DOM runtime', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `<!doctype html>
      <html>
        <head><title>Example article</title></head>
        <body>
          <nav>Navigation that should not become the article body.</nav>
          <article>
            <h1>Useful heading</h1>
            <p>This is a sufficiently detailed paragraph for readable article extraction.</p>
            <p>A second meaningful paragraph gives the readability scorer enough content.</p>
          </article>
        </body>
      </html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )));

    const tool = createWebFetchTool(() => undefined);
    const result = await tool.execute('test-call', { url: 'https://example.com/article' });
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';

    expect(text).toContain('Useful heading');
    expect(text).toContain('sufficiently detailed paragraph');
    expect(text).not.toContain('Navigation that should not become');
  });
});
