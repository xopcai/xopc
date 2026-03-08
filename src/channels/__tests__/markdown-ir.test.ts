/**
 * Markdown IR (Intermediate Representation) Tests
 */

import { describe, it, expect } from 'vitest';
import {
  parseMarkdownToIR,
  renderToTelegramHtml,
  renderToPlainText,
  markdownToTelegramChunks,
} from '../markdown-ir.js';

describe('parseMarkdownToIR', () => {
  it('should parse plain text', () => {
    const ir = parseMarkdownToIR('Hello world');
    expect(ir.nodes).toHaveLength(1);
    expect(ir.nodes[0].type).toBe('paragraph');
  });

  it('should parse bold text', () => {
    const ir = parseMarkdownToIR('**bold**');
    expect(ir.nodes[0].type).toBe('paragraph');
    const children = ir.nodes[0].children;
    expect(children).toHaveLength(1);
    expect(children![0].type).toBe('bold');
    expect(children![0].content).toBe('bold');
  });

  it('should parse italic text', () => {
    const ir = parseMarkdownToIR('*italic*');
    const children = ir.nodes[0].children;
    expect(children![0].type).toBe('italic');
  });

  it('should parse code blocks', () => {
    const ir = parseMarkdownToIR('```js\nconst x = 1;\n```');
    expect(ir.nodes[0].type).toBe('code_block');
    expect(ir.nodes[0].language).toBe('js');
    expect(ir.nodes[0].content).toBe('const x = 1;');
  });

  it('should parse inline code', () => {
    const ir = parseMarkdownToIR('Use `code` here');
    const children = ir.nodes[0].children;
    expect(children![1].type).toBe('code');
  });

  it('should parse links', () => {
    const ir = parseMarkdownToIR('[text](https://example.com)');
    const children = ir.nodes[0].children;
    expect(children![0].type).toBe('link');
    expect(children![0].href).toBe('https://example.com');
  });

  it('should parse blockquotes', () => {
    const ir = parseMarkdownToIR('> quote');
    expect(ir.nodes[0].type).toBe('blockquote');
  });

  it('should parse strikethrough', () => {
    const ir = parseMarkdownToIR('~~deleted~~');
    const children = ir.nodes[0].children;
    expect(children![0].type).toBe('strikethrough');
  });

  it('should parse spoilers', () => {
    const ir = parseMarkdownToIR('||spoiler||');
    const children = ir.nodes[0].children;
    expect(children![0].type).toBe('spoiler');
  });

  it('should parse nested formatting', () => {
    const ir = parseMarkdownToIR('**bold *italic***');
    const bold = ir.nodes[0].children![0];
    expect(bold.type).toBe('bold');
    // Content is "bold *italic*" which parses to text + italic
    expect(bold.children).toBeDefined();
    expect(bold.children!.length).toBeGreaterThan(0);
    // Find the italic node among children
    const italicNode = bold.children!.find(n => n.type === 'italic');
    expect(italicNode).toBeDefined();
    expect(italicNode!.content).toBe('italic');
  });

  it('should handle multiple paragraphs', () => {
    const ir = parseMarkdownToIR('Para 1\n\nPara 2');
    expect(ir.nodes).toHaveLength(2);
  });
});

describe('renderToTelegramHtml', () => {
  it('should render bold text', () => {
    const ir = parseMarkdownToIR('**bold**');
    const html = renderToTelegramHtml(ir);
    expect(html).toBe('<b>bold</b>');
  });

  it('should render italic text', () => {
    const ir = parseMarkdownToIR('*italic*');
    const html = renderToTelegramHtml(ir);
    expect(html).toBe('<i>italic</i>');
  });

  it('should render code blocks', () => {
    const ir = parseMarkdownToIR('```js\ncode\n```');
    const html = renderToTelegramHtml(ir);
    expect(html).toBe('<pre><code class="language-js">code</code></pre>');
  });

  it('should render inline code', () => {
    const ir = parseMarkdownToIR('`code`');
    const html = renderToTelegramHtml(ir);
    expect(html).toBe('<code>code</code>');
  });

  it('should render links', () => {
    const ir = parseMarkdownToIR('[text](https://example.com)');
    const html = renderToTelegramHtml(ir);
    expect(html).toBe('<a href="https://example.com">text</a>');
  });

  it('should render blockquotes', () => {
    const ir = parseMarkdownToIR('> quote');
    const html = renderToTelegramHtml(ir);
    expect(html).toBe('<blockquote>quote</blockquote>');
  });

  it('should escape HTML entities', () => {
    const ir = parseMarkdownToIR('A < B & C');
    const html = renderToTelegramHtml(ir);
    expect(html).toContain('&lt;');
    expect(html).toContain('&amp;');
  });

  it('should render spoilers', () => {
    const ir = parseMarkdownToIR('||secret||');
    const html = renderToTelegramHtml(ir);
    expect(html).toBe('<tg-spoiler>secret</tg-spoiler>');
  });
});

describe('renderToPlainText', () => {
  it('should remove bold markers', () => {
    const ir = parseMarkdownToIR('**bold**');
    const text = renderToPlainText(ir);
    expect(text).toBe('bold');
  });

  it('should convert links to text with URL', () => {
    const ir = parseMarkdownToIR('[text](https://example.com)');
    const text = renderToPlainText(ir);
    expect(text).toBe('text (https://example.com)');
  });

  it('should keep code block content', () => {
    const ir = parseMarkdownToIR('```\ncode\n```');
    const text = renderToPlainText(ir);
    expect(text).toBe('code');
  });
});

describe('markdownToTelegramChunks', () => {
  it('should return single chunk for short text', () => {
    const chunks = markdownToTelegramChunks('Hello world', 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].html).toBe('Hello world');
    expect(chunks[0].text).toBe('Hello world');
  });

  it('should split long text into multiple chunks', () => {
    const text = 'A '.repeat(500); // 1000 chars
    const chunks = markdownToTelegramChunks(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('should preserve code blocks in chunks', () => {
    const text = '```js\n' + 'code\n'.repeat(50) + '```';
    const chunks = markdownToTelegramChunks(text, 100);
    // Code blocks should not be split mid-block
    for (const chunk of chunks) {
      const openTags = (chunk.html.match(/<pre>/g) || []).length;
      const closeTags = (chunk.html.match(/<\/pre>/g) || []).length;
      // Each chunk should have balanced tags or be part of a valid split
      expect(openTags).toBeGreaterThanOrEqual(closeTags);
    }
  });

  it('should provide both HTML and plain text for each chunk', () => {
    const chunks = markdownToTelegramChunks('**bold** text', 100);
    expect(chunks[0].html).toBe('<b>bold</b> text');
    expect(chunks[0].text).toBe('bold text');
  });
});
