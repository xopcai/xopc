import fixtures from '../fixtures/dialect-v1.json';
import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';

import { readDisplayMathAt, readInlineMathAt } from '../src/syntax';
import { mathRanges } from '../src/remark';
import { markdownItMath } from '../src/markdownIt';
import { mathCacheStats, renderMath, renderMathHtml } from '../src/render';

const screenshot = String.raw`\[\mathcal{R}_{syn}(s_T;g)\triangleq\mathbb{I}\big[V_g(s_T)=\mathrm{True}\big]\]`;

describe('xopc-math-v1', () => {
  it.each(fixtures)('matches fixture $id in markdown-it', ({markdown, mathCount}) => {
    const md = new MarkdownIt({ html: false }); markdownItMath(md);
    const html = md.render(markdown);
    expect((html.match(/class="katex"/g) ?? []).length).toBe(mathCount);
    if (markdown.startsWith('![')) expect(html).toContain('alt="$x$"');
  });
  it('renders the reported formula with visual HTML and accessible MathML', () => {
    const source = readDisplayMathAt(screenshot)!;
    const result = renderMath(source);
    expect(result.status).toBe('ready');
    if (result.status === 'ready') expect(result.html).toContain('<math');
    expect(source.raw).toBe(screenshot);
  });
  it.each(['$x$', String.raw`\(\frac{1}{2}\)`, String.raw`\(100\)`])('recognizes inline %s', raw => {
    expect(readInlineMathAt(raw)?.state).toBe('complete');
    expect(mathRanges(raw)).toEqual([{ start: 0, end: raw.length }]);
  });
  it.each(['$100$', '$5 and $10', '$ x$', '$x $', '$x$2', String.raw`\\(x\)`, '$$x$$'])('preserves ambiguous or escaped %s', raw => {
    expect(readInlineMathAt(raw)).toBeUndefined();
  });
  it('leaves escaped xopc links to the Markdown link parser', () => {
    const raw = String.raw`[打开]\(xopc://open?kind=session&key=test\)`;
    expect(readInlineMathAt(raw, raw.indexOf('\\('))).toBeUndefined();
    expect(mathRanges(raw)).toEqual([]);
  });
  it('ignores closing delimiters in TeX comments and retains blank lines', () => {
    const raw = '\\[\n% \\]\na=b\n\nc=d\n\\]';
    expect(readDisplayMathAt(raw)?.state).toBe('complete');
    expect(mathRanges(raw)).toEqual([{ start: 0, end: raw.length }]);
  });
  it('does not parse fenced or inline code, URLs, and escaped delimiters as math', () => {
    expect(mathRanges('`$x$`\n\n```ts\n\\[x\\]\n```\n\n[link](https://example.com/$x$)')).toEqual([]);
  });
  it('does not swallow text outside an unclosed quote', () => {
    const raw = '> \\[\n> x^2\n\nOutside';
    expect(mathRanges(raw)[0]?.end).toBeLessThan(raw.indexOf('Outside'));
  });
  it('does not synthesize delimiters at any streaming boundary', () => {
    for (let offset = 2; offset < screenshot.length; offset++) {
      const source = readDisplayMathAt(screenshot.slice(0, offset))!;
      expect(source.state).toBe('pending');
      expect(renderMath(source, { streaming: true }).status).toBe('pending');
      expect(renderMath(source).status).toBe('fallback');
    }
    expect(renderMath(readDisplayMathAt(screenshot)!).status).toBe('ready');
  });
  it('isolates macros, blocks remote HTML commands and bounds the cache', () => {
    renderMath(readInlineMathAt(String.raw`\(\gdef\foo{x}\foo\)`)!);
    expect(renderMath(readInlineMathAt(String.raw`\(\foo\)`)! ).status).toBe('fallback');
    const html = renderMathHtml(readInlineMathAt(String.raw`\(\href{javascript:alert(1)}{x}\)`)!);
    expect(html).not.toMatch(/<a[ >]/);
    expect(html).not.toContain('<script');
    for (let i = 0; i < 300; i++) renderMath(readInlineMathAt(`\\(x+${i}\\)`)!);
    expect(mathCacheStats().entries).toBeLessThanOrEqual(256);
    expect(mathCacheStats().bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  });
  it('renders markdown-it containers and preserves ordinary money', () => {
    const md = new MarkdownIt({ html: false }); markdownItMath(md);
    const html = md.render('> \\[\n> x^2\n> \\]\n\n价格 $5，运费 $10\n\n- \\(a_i\\)');
    expect(html.match(/class="katex"/g)).toHaveLength(2);
    expect(html).toContain('价格 $5，运费 $10');
  });
});
