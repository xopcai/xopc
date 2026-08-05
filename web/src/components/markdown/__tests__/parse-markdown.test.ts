import { describe, expect, it } from 'vitest';

import { parseMarkdown } from '@/components/markdown/parse-markdown';

describe('parseMarkdown', () => {
  it('renders quoted CJK text as strong without requiring whitespace before the marker', () => {
    const html = parseMarkdown('而是**"你现在的孤独感，有没有别的地方可以安放？"**');

    expect(html).toContain(
      '而是<strong>&quot;你现在的孤独感，有没有别的地方可以安放？&quot;</strong>',
    );
  });

  it('finds punctuation-bound strong text after earlier quoted text in the paragraph', () => {
    const html = parseMarkdown(
      '所以问题的根源，可能不是"怎么放下她"，而是**"你现在的孤独感，有没有别的地方可以安放？"**',
    );

    expect(html).toContain(
      '而是<strong>&quot;你现在的孤独感，有没有别的地方可以安放？&quot;</strong>',
    );
  });

  it.each([
    ['这是**“重要的话”**', '“重要的话”'],
    ['这是**「重要的话」**', '「重要的话」'],
    ['这是**（重要的话）**', '（重要的话）'],
    ['这是**重点。**接着说', '重点。'],
  ])('renders punctuation-bound strong text in %s', (markdown, strongText) => {
    const html = parseMarkdown(markdown);

    expect(html).toContain(`<strong>${strongText}</strong>`);
  });

  it('keeps inline Markdown inside punctuation-bound strong text', () => {
    const html = parseMarkdown('这是**“包含 `code` 和 *强调*”**');

    expect(html).toContain(
      '<strong>“包含 <code>code</code> 和 <em>强调</em>”</strong>',
    );
  });

  it('keeps strong-looking text inside a code span within the strong text', () => {
    const html = parseMarkdown('这是**“运行 `**literal**` 即可”**');

    expect(html).toContain(
      '<strong>“运行 <code>**literal**</code> 即可”</strong>',
    );
  });

  it('renders consecutive punctuation-bound strong spans independently', () => {
    const html = parseMarkdown('**“第一句”**和**“第二句”**');

    expect(html).toContain(
      '<strong>“第一句”</strong>和<strong>“第二句”</strong>',
    );
  });

  it('does not treat strong markers inside an inline code span as formatting', () => {
    const html = parseMarkdown('示例：`而是**"原样"**`');

    expect(html).toContain('<code>而是**&quot;原样&quot;**</code>');
    expect(html).not.toContain('<strong>');
  });

  it.each([
    ['** 未闭合 **', '<p>** 未闭合 **</p>\n'],
    ['**"未闭合', '<p>**&quot;未闭合</p>\n'],
    ['普通 **粗体** 文本', '<p>普通 <strong>粗体</strong> 文本</p>\n'],
    ['***"粗斜体"***', '<p><em><strong>&quot;粗斜体&quot;</strong></em></p>\n'],
  ])('preserves standard emphasis behavior for %s', (markdown, expected) => {
    expect(parseMarkdown(markdown)).toBe(expected);
  });
});
