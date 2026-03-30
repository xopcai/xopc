import { describe, it, expect } from 'vitest';
import { parseBingCnHtml } from '../providers/bing-html.js';
import { parseDdgHtml } from '../providers/duckduckgo-html.js';

describe('parseBingCnHtml', () => {
  it('extracts title, url, and caption', () => {
    const html = `
      <li class="b_algo">
        <h2><a href="https://example.com/page">Example Title</a></h2>
        <div class="b_caption"><p>A short description here.</p></div>
      </li>`;
    const out = parseBingCnHtml(html, 5);
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain('example.com');
    expect(out[0].title).toContain('Example Title');
    expect(out[0].description).toMatch(/description/i);
  });
});

describe('parseDdgHtml', () => {
  it('extracts result links', () => {
    const html = `
      <a class="result__a" href="https://duck.example/a">First hit</a>
      <a class="result__snippet">Snippet text for first.</a>
      <a class="result__a" href="https://duck.example/b">Second hit</a>
    `;
    const out = parseDdgHtml(html, 5);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].title).toMatch(/First hit/);
    expect(out[0].url).toContain('duck.example');
  });
});
