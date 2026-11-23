import { describe, expect, it } from 'vitest';

import { renderSafeMarkdown } from './markdown-content';

describe('renderSafeMarkdown', () => {
  it('renders common chat markdown', () => {
    const rendered = renderSafeMarkdown('## Summary\n\n- **Done**\n- `safe`');
    expect(rendered).toContain('<h2>Summary</h2>');
    expect(rendered).toContain('<strong>Done</strong>');
    expect(rendered).toContain('<code>safe</code>');
  });

  it('escapes raw HTML and blocks unsafe links', () => {
    const rendered = renderSafeMarkdown('<script>alert(1)</script>\n\n[bad](javascript:alert(1))');
    expect(rendered).not.toContain('<script>');
    expect(rendered).not.toContain('href="javascript:');
    expect(rendered).toContain('&lt;script&gt;');
  });

  it('opens safe links outside the extension page', () => {
    const rendered = renderSafeMarkdown('[docs](https://example.com)');
    expect(rendered).toContain('target="_blank"');
    expect(rendered).toContain('rel="noopener noreferrer"');
  });

  it('renders fenced code blocks with a language header and copy button while escaping HTML', () => {
    const rendered = renderSafeMarkdown('```ts\nconst x = "<script>";\n```');
    expect(rendered).toContain('class="md-code-block"');
    expect(rendered).toContain('<span class="md-code-lang">ts</span>');
    expect(rendered).toContain('data-copy-code="true"');
    expect(rendered).toContain('&lt;script&gt;');
    expect(rendered).not.toContain('<script>');
  });

  it('wraps tables in a scrollable container', () => {
    const rendered = renderSafeMarkdown('| A | B |\n| - | - |\n| 1 | 2 |');
    expect(rendered).toContain('<div class="md-table-wrap"><table>');
  });
});
