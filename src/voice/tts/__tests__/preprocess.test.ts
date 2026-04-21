import { describe, it, expect } from 'vitest';
import {
  stripMarkdown,
  normalizeWhitespace,
  truncateText,
  preprocessText,
  checkTTSSuitability,
} from '../preprocess.js';

describe('TTS Text Preprocessing', () => {
  describe('stripMarkdown', () => {
    it('strips headers', () => {
      expect(stripMarkdown('### System Design Basics')).toBe('System Design Basics');
      expect(stripMarkdown('## Heading\nSome text')).toBe('Heading\nSome text');
    });

    it('strips bold and italic', () => {
      expect(stripMarkdown('This is **important** and *useful*')).toBe(
        'This is important and useful'
      );
      expect(stripMarkdown('This is __bold__ and _italic_')).toBe('This is bold and italic');
    });

    it('strips inline code', () => {
      expect(stripMarkdown('Use `consistent hashing` for distribution')).toBe(
        'Use consistent hashing for distribution'
      );
    });

    it('strips code blocks', () => {
      const input = '```typescript\nconst x = 1;\n```';
      expect(stripMarkdown(input)).toBe('const x = 1;');
    });

    it('strips blockquotes', () => {
      expect(stripMarkdown('> This is a quote')).toBe('This is a quote');
    });

    it('strips links but keeps text', () => {
      expect(stripMarkdown('Check [this link](https://example.com)')).toBe('Check this link');
    });

    it('strips images but keeps alt text', () => {
      expect(stripMarkdown('![Alt text](image.png)')).toBe('Alt text');
    });

    it('strips strikethrough', () => {
      expect(stripMarkdown('This is ~~deleted~~ text')).toBe('This is deleted text');
    });

    it('strips bullet points', () => {
      expect(stripMarkdown('- Item 1\n* Item 2\n+ Item 3')).toBe('Item 1\nItem 2\nItem 3');
    });

    it('strips numbered lists', () => {
      expect(stripMarkdown('1. First\n2. Second')).toBe('First\nSecond');
    });

    it('handles complex markdown', () => {
      const input = `## Heading with **bold** and *italic*

> A blockquote with \`code\`

Some ~~deleted~~ content.

- Item 1
- Item 2`;

      const result = stripMarkdown(input);
      expect(result).not.toContain('#');
      expect(result).not.toContain('**');
      expect(result).not.toContain('`');
      expect(result).not.toContain('>');
      expect(result).not.toContain('~~');
      expect(result).not.toContain('-');
      expect(result).toContain('Heading with bold and italic');
      expect(result).toContain('A blockquote with code');
    });
  });

  describe('normalizeWhitespace', () => {
    it('collapses multiple spaces', () => {
      expect(normalizeWhitespace('Hello    world')).toBe('Hello world');
    });

    it('trims lines', () => {
      expect(normalizeWhitespace('  Hello world  ')).toBe('Hello world');
    });

    it('normalizes newlines', () => {
      expect(normalizeWhitespace('Line 1\n\n\n\nLine 2')).toBe('Line 1\n\nLine 2');
    });
  });

  describe('truncateText', () => {
    it('does not truncate short text', () => {
      const result = truncateText('Hello world', 100);
      expect(result.text).toBe('Hello world');
      expect(result.wasTruncated).toBe(false);
    });

    it('truncates long text at word boundary', () => {
      const text = 'This is a very long text that needs to be truncated';
      const result = truncateText(text, 20);
      expect(result.wasTruncated).toBe(true);
      expect(result.text.endsWith('...')).toBe(true);
      expect(result.text.length).toBeLessThanOrEqual(20);
    });

    it('adds ellipsis when truncating', () => {
      const text = 'ThisIsAVeryLongWordWithoutSpaces';
      const result = truncateText(text, 20);
      expect(result.wasTruncated).toBe(true);
      expect(result.text.endsWith('...')).toBe(true);
    });
  });

  describe('preprocessText', () => {
    it('applies all preprocessing steps', () => {
      const input = '## **Hello**    world\n\n\n\nThis is `code`';
      const result = preprocessText(input, { maxLength: 100 });

      expect(result.text).toBe('Hello world\n\nThis is code');
      expect(result.wasTruncated).toBe(false);
      expect(result.originalLength).toBe(input.length);
    });

    it('respects maxLength', () => {
      const input = 'This is a very long text that will be truncated';
      const result = preprocessText(input, { maxLength: 20 });

      expect(result.wasTruncated).toBe(true);
      expect(result.finalLength).toBeLessThanOrEqual(20);
    });

    it('can skip markdown stripping', () => {
      const input = '## Hello';
      const result = preprocessText(input, { stripMarkdown: false });

      expect(result.text).toBe('## Hello');
    });
  });

  describe('checkTTSSuitability', () => {
    it('allows suitable text', () => {
      const result = checkTTSSuitability('This is a normal sentence for TTS.');
      expect(result.suitable).toBe(true);
    });

    it('rejects too short text', () => {
      const result = checkTTSSuitability('Hi');
      expect(result.suitable).toBe(false);
      expect(result.reason).toContain('too short');
    });

    it('rejects code-heavy text', () => {
      const result = checkTTSSuitability('const x={a:1,b:2};fn()=>{return x;};y=[1,2];');
      expect(result.suitable).toBe(false);
      expect(result.reason).toContain('code');
    });

    it('rejects URL-only text', () => {
      const result = checkTTSSuitability('https://example.com https://test.com');
      expect(result.suitable).toBe(false);
      expect(result.reason).toContain('URLs');
    });
  });
});
