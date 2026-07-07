import { describe, expect, it } from 'vitest';

import {
  isNativeMarkdownFlushResponse,
  joinNativeMarkdownBlocks,
  NATIVE_JOIN_MARKDOWN_BLOCKS_SCRIPT,
  shouldForwardNativeMarkdownMessage,
} from '../editor/native-editor-markdown';

describe('native editor markdown bridge', () => {
  it('keeps adjacent text blocks as single newlines', () => {
    expect(joinNativeMarkdownBlocks(['first line', 'second line'])).toBe('first line\nsecond line');
  });

  it('keeps source softbreaks inside a paragraph for standard Markdown rendering', () => {
    expect(joinNativeMarkdownBlocks([{ text: 'first line\nsecond line', paragraph: true }])).toBe('first line\nsecond line');
  });

  it('preserves paragraph breaks between controlled paragraph blocks', () => {
    expect(joinNativeMarkdownBlocks([
      { text: 'first paragraph', paragraph: true },
      { text: 'second paragraph', paragraph: true },
    ])).toBe('first paragraph\n\nsecond paragraph');
  });

  it('keeps browser-created blocks compact', () => {
    expect(joinNativeMarkdownBlocks([
      { text: 'first line', paragraph: false },
      { text: 'second line', paragraph: false },
    ])).toBe('first line\nsecond line');
  });

  it('uses WebView-safe JavaScript for injected serialization', () => {
    expect(NATIVE_JOIN_MARKDOWN_BLOCKS_SCRIPT).not.toMatch(/\?\.|\.\.\.|=>|\bconst\b|\blet\b/);
    const run = new Function(`${NATIVE_JOIN_MARKDOWN_BLOCKS_SCRIPT}; return joinNativeMarkdownBlocks([{ text: 'a', paragraph: true }, { text: 'b', paragraph: true }]);`);
    expect(run()).toBe('a\n\nb');
  });

  it('keeps WebView-injected browser blocks compact', () => {
    const run = new Function(`${NATIVE_JOIN_MARKDOWN_BLOCKS_SCRIPT}; return joinNativeMarkdownBlocks([{ text: 'a', paragraph: false }, { text: 'b', paragraph: false }]);`);
    expect(run()).toBe('a\nb');
  });

  it('does not forward initial ready markdown as an edit', () => {
    expect(shouldForwardNativeMarkdownMessage({ type: 'ready', markdown: 'first line\n\nsecond line' }, 'first line\nsecond line')).toBe(false);
  });

  it('forwards changed content messages', () => {
    expect(shouldForwardNativeMarkdownMessage({
      type: 'content',
      reason: 'typing',
      markdown: 'first line\nsecond line!',
    }, 'first line\nsecond line')).toBe(true);
  });

  it('identifies native flush responses by request id', () => {
    expect(isNativeMarkdownFlushResponse({
      type: 'content',
      reason: 'flush',
      markdown: 'latest body',
      flushRequestId: 7,
    }, 7)).toBe(true);
    expect(isNativeMarkdownFlushResponse({
      type: 'content',
      reason: 'flush',
      markdown: 'latest body',
      flushRequestId: 8,
    }, 7)).toBe(false);
  });
});
