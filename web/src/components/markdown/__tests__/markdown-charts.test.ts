import { describe, expect, it } from 'vitest';

import { parseMarkdown, parseMarkdownWithCharts } from '../parse-markdown';

describe('document chart fences', () => {
  const source = JSON.stringify({ title: '<img src=x onerror=alert(1)>', values: [1, null, -2] });

  it('collects exact source separately from HTML and preserves surrounding Markdown', () => {
    const parsed = parseMarkdownWithCharts(`# Title\n\nBefore\n\n\`\`\`chart\n${source}\n\`\`\`\n\nAfter`);
    expect(parsed.charts).toEqual([{ source, closed: true }]);
    expect(parsed.html).toContain('<h1>Title</h1>');
    expect(parsed.html).toContain('data-md-chart="0"');
    expect(parsed.html).toContain('<p>After</p>');
    expect(parsed.html).not.toContain('onerror');
  });

  it.each(['```', '~~~~'])('supports %s fences and detects missing real closers', fence => {
    expect(parseMarkdownWithCharts(`${fence}chart\n${source}\n${fence}`).charts[0].closed).toBe(true);
    expect(parseMarkdownWithCharts(`${fence}chart\n${source}`).charts[0].closed).toBe(false);
  });

  it('handles nested blocks and multiple independent charts', () => {
    const parsed = parseMarkdownWithCharts(`> \`\`\`chart\n> ${source}\n> \`\`\`\n\n\`\`\`chart\n{}\n\`\`\``);
    expect(parsed.charts).toEqual([{ source, closed: true }, { source: '{}', closed: true }]);
  });

  it('accepts CommonMark spacing between the fence and language', () => {
    expect(parseMarkdownWithCharts(`\`\`\` chart\n${source}\n\`\`\``).charts).toEqual([{ source, closed: true }]);
  });

  it('does not interpret chart examples inside another code fence', () => {
    expect(parseMarkdownWithCharts(`\`\`\`\`markdown\n\`\`\`chart\n${source}\n\`\`\`\n\`\`\`\``).charts).toEqual([]);
  });

  it('keeps chart code readable when chart rendering is not requested', () => {
    const html = parseMarkdown(`\`\`\`chart\n${source}\n\`\`\``);
    expect(html).toContain('language-chart');
    expect(html).not.toContain('data-md-chart');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
