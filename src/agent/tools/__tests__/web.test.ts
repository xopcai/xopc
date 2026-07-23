import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebFetchTool } from '../web.js';

describe('createWebFetchTool', () => {
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
