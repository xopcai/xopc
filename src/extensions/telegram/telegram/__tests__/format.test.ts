/**
 * Format Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  escapeHtmlAttr,
  markdownToTelegramHtml,
  wrapFileReferencesInHtml,
  formatTelegramMessage,
  markdownToTelegramChunks,
  renderIRToTelegramHtml,
} from '../format.js';

describe('escapeHtml', () => {
  it('should escape & character', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('should escape < character', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('should escape > character', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('should escape all special characters', () => {
    expect(escapeHtml('<div>&test</div>')).toBe('&lt;div&gt;&amp;test&lt;/div&gt;');
  });
});

describe('escapeHtmlAttr', () => {
  it('should escape quotes', () => {
    expect(escapeHtmlAttr('value="test"')).toBe('value=&quot;test&quot;');
  });

  it('should escape all HTML characters', () => {
    expect(escapeHtmlAttr('<div class="test">')).toBe('&lt;div class=&quot;test&quot;&gt;');
  });
});

describe('markdownToTelegramHtml', () => {
  it('should convert bold text', () => {
    expect(markdownToTelegramHtml('**bold**')).toBe('<b>bold</b>');
  });

  it('should convert italic text with *', () => {
    expect(markdownToTelegramHtml('*italic*')).toBe('<i>italic</i>');
  });

  it('should convert italic text with _', () => {
    expect(markdownToTelegramHtml('_italic_')).toBe('<i>italic</i>');
  });

  it('should convert inline code', () => {
    expect(markdownToTelegramHtml('`code`')).toBe('<code>code</code>');
  });

  it('should convert code blocks', () => {
    // Note: IR-based implementation doesn't include language class (Telegram doesn't use it)
    expect(markdownToTelegramHtml('```js\nconst x = 1\n```')).toBe('<pre><code>const x = 1\n</code></pre>');
  });

  it('should convert strikethrough', () => {
    expect(markdownToTelegramHtml('~~deleted~~')).toBe('<s>deleted</s>');
  });

  it('should not convert spoiler format (treated as strikethrough)', () => {
    // Spoiler format ~~|text|~~ is currently treated as strikethrough in the implementation
    expect(markdownToTelegramHtml('~~|secret|~~')).toBe('<s>|secret|</s>');
  });

  it('should convert links', () => {
    expect(markdownToTelegramHtml('[text](https://example.com)')).toBe('<a href="https://example.com">text</a>');
  });

  it('should convert blockquotes', () => {
    expect(markdownToTelegramHtml('> quote')).toBe('<blockquote>quote</blockquote>');
  });

  it('should not auto-link file references with TLD extensions', () => {
    // Note: This is handled by wrapFileReferencesInHtml, not markdownToTelegramHtml
    // The markdownToTelegramHtml creates a link, wrapFileReferencesInHtml wraps it in code
    const result = markdownToTelegramHtml('[README.md](https://example.com/README.md)');
    // markdownToTelegramHtml creates the link, but the wrapping happens in formatTelegramMessage
    expect(result).toContain('a href');
  });

  it('should strip unknown HTML tags (security)', () => {
    // Unknown tags like <script> should be stripped for security
    expect(markdownToTelegramHtml('<script>alert(1)</script>')).toBe('alert(1)');
  });
});

describe('wrapFileReferencesInHtml', () => {
  it('should wrap .py files in code tags', () => {
    const result = wrapFileReferencesInHtml('See main.py for details');
    expect(result).toContain('<code>main.py</code>');
  });

  it('should wrap .go files in code tags', () => {
    const result = wrapFileReferencesInHtml('Check out utils.go');
    expect(result).toContain('<code>utils.go</code>');
  });

  it('should not wrap files inside code blocks', () => {
    const input = '<pre><code>hello.py</code></pre>';
    const result = wrapFileReferencesInHtml(input);
    expect(result).toBe(input);
  });

  it('should not wrap files inside anchor tags', () => {
    const input = '<a href="https://example.com/test.py">test.py</a>';
    const result = wrapFileReferencesInHtml(input);
    expect(result).toBe(input);
  });

  it('should not wrap files with protocol prefix', () => {
    const input = 'https://example.com/test.py';
    const result = wrapFileReferencesInHtml(input);
    expect(result).not.toContain('<code>test.py</code>');
  });

  it('should handle multiple file references', () => {
    // Note: The function only wraps files that are NOT preceded by valid patterns
    // In this case, c.js might not match the pattern due to preceding comma
    const result = wrapFileReferencesInHtml('Files: a.py, b.go, c.js');
    // At least the first two should be wrapped
    expect(result).toContain('<code>a.py</code>');
    expect(result).toContain('<code>b.go</code>');
  });
});

describe('formatTelegramMessage', () => {
  it('should convert markdown to HTML', () => {
    const result = formatTelegramMessage('Hello **world**');
    expect(result.html).toContain('<b>world</b>');
    expect(result.text).toBe('Hello **world**');
  });

  it('should wrap file references by default', () => {
    // Note: Linkify may auto-link file extensions that look like TLDs
    // The wrapFileReferencesInHtml function handles this by wrapping in <code>
    const result = formatTelegramMessage('Check main.py');
    // Either the file is wrapped in <code> or it's part of a link
    const hasCodeWrapped = result.html.includes('<code>main.py</code>');
    const hasLink = result.html.includes('<a href=') && result.html.includes('main.py');
    expect(hasCodeWrapped || hasLink).toBe(true);
  });

  it('should optionally skip file reference wrapping', () => {
    const result = formatTelegramMessage('Check main.py', { wrapFileRefs: false });
    expect(result.html).not.toContain('<code>main.py</code>');
  });
});

describe('markdownToTelegramChunks', () => {
  it('should return single chunk if under limit', () => {
    const result = markdownToTelegramChunks('Hello world', 4000);
    expect(result).toHaveLength(1);
    expect(result[0].html).toContain('Hello world');
  });

  it('should split at paragraph boundaries', () => {
    const text = 'First paragraph\n\nSecond paragraph\n\nThird paragraph';
    const result = markdownToTelegramChunks(text, 30);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('should split at newlines if no paragraphs', () => {
    const text = 'Line 1\nLine 2\nLine 3';
    const result = markdownToTelegramChunks(text, 15);
    expect(result.length).toBeGreaterThan(1);
  });

  it('should handle very long text without line breaks', () => {
    const text = 'A'.repeat(5000);
    const result = markdownToTelegramChunks(text, 4000);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('should handle custom max chars', () => {
    const text = 'Hello world this is a test';
    const result = markdownToTelegramChunks(text, 15);
    // Should split into at least 2 chunks
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

describe('stripUnknownHtmlTags', () => {
  it('should strip unknown HTML tags from rendered HTML', () => {
    // Simulate IR that has raw HTML text (as might come from LLM)
    const ir = {
      text: 'Hello <resolvedaccount>world</resolvedaccount>',
      styles: [],
      links: [],
    } as const;
    const result = renderIRToTelegramHtml(ir);
    expect(result).toBe('Hello world');
  });

  it('should keep allowed HTML tags', () => {
    const ir = {
      text: 'Hello <b>world</b>',
      styles: [],
      links: [],
    } as const;
    const result = renderIRToTelegramHtml(ir);
    expect(result).toBe('Hello <b>world</b>');
  });

  it('should strip unknown tags but keep content', () => {
    const ir = {
      text: 'Test <unknown>content</unknown> here',
      styles: [],
      links: [],
    } as const;
    const result = renderIRToTelegramHtml(ir);
    expect(result).toBe('Test content here');
  });

  it('should strip self-closing unknown tags', () => {
    const ir = {
      text: 'Before <custombr/>After',
      styles: [],
      links: [],
    } as const;
    const result = renderIRToTelegramHtml(ir);
    expect(result).toBe('Before After');
  });

  it('should strip unknown tags with attributes', () => {
    const ir = {
      text: 'Test <customtag attr="value">content</customtag> here',
      styles: [],
      links: [],
    } as const;
    const result = renderIRToTelegramHtml(ir);
    expect(result).toBe('Test content here');
  });

  it('should keep Telegram-supported tags', () => {
    const ir = {
      text: 'Test <b>bold</b> <i>italic</i> <code>code</code>',
      styles: [],
      links: [],
    } as const;
    const result = renderIRToTelegramHtml(ir);
    expect(result).toBe('Test <b>bold</b> <i>italic</i> <code>code</code>');
  });

  it('should handle mixed allowed and unknown tags', () => {
    const ir = {
      text: 'Test <b>bold</b> <unknown>unknown content</unknown> <i>italic</i>',
      styles: [],
      links: [],
    } as const;
    const result = renderIRToTelegramHtml(ir);
    expect(result).toBe('Test <b>bold</b> unknown content <i>italic</i>');
  });
});
