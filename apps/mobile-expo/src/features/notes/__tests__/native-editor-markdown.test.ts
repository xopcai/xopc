import { describe, expect, it } from 'vitest';

import {
  decideNativeMarkdownMessage,
  isNativeCodeFenceClosing,
  isNativeIndentedListLine,
  isNativeMarkdownFlushResponse,
  joinNativeMarkdownBlocks,
  NATIVE_CODE_FENCE_HELPERS_SCRIPT,
  NATIVE_INDENTED_BLOCK_HELPERS_SCRIPT,
  NATIVE_JOIN_MARKDOWN_BLOCKS_SCRIPT,
  parseNativeCodeFenceOpening,
  serializeNativeCodeFence,
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

  it('preserves fenced-code languages and longer backtick runs', () => {
    expect(parseNativeCodeFenceOpening('```ts')).toEqual({ marker: '```', language: 'ts' });
    expect(parseNativeCodeFenceOpening('```` python ')).toEqual({ marker: '````', language: 'python' });
    expect(parseNativeCodeFenceOpening('~~~js')).toEqual({ marker: '~~~', language: 'js' });
    expect(isNativeCodeFenceClosing('```', '```')).toBe(true);
    expect(isNativeCodeFenceClosing('```', '````')).toBe(false);
    expect(isNativeCodeFenceClosing('~~~~', '~~~')).toBe(true);
    expect(isNativeCodeFenceClosing('```', '~~~')).toBe(false);
    expect(serializeNativeCodeFence('ts', 'const value = ```;')).toBe(
      '````ts\nconst value = ```;\n````',
    );
    expect(serializeNativeCodeFence('ts', '\nconst value = 1;\n')).toBe(
      '```ts\n\nconst value = 1;\n\n```',
    );
  });

  it('keeps code-fence helpers WebView-safe and behaviorally aligned', () => {
    expect(NATIVE_CODE_FENCE_HELPERS_SCRIPT).not.toMatch(/\?\.|\.\.\.|=>|\bconst\b|\blet\b/);
    const run = new Function(`${NATIVE_CODE_FENCE_HELPERS_SCRIPT}; return {
      opening: parseNativeCodeFenceOpening('~~~js'),
      closing: isNativeCodeFenceClosing('~~~~', '~~~'),
      serialized: serializeNativeCodeFence('js', 'value = ${'`'.repeat(3)}')
    };`);
    expect(run()).toEqual({
      opening: { marker: '~~~', language: 'js' },
      closing: true,
      serialized: '````js\nvalue = ```\n````',
    });
  });

  it('recognizes nested list lines without flattening their indentation', () => {
    expect(isNativeIndentedListLine('  - child')).toBe(true);
    expect(isNativeIndentedListLine('    - [x] nested task')).toBe(true);
    expect(isNativeIndentedListLine('  1. nested ordered')).toBe(true);
    expect(isNativeIndentedListLine('- top level')).toBe(false);
    expect(joinNativeMarkdownBlocks([
      { text: '- parent', paragraph: false },
      { text: '  - child', paragraph: true },
    ])).toBe('- parent\n  - child');
  });

  it('keeps indented-list detection WebView-safe and aligned', () => {
    expect(NATIVE_INDENTED_BLOCK_HELPERS_SCRIPT).not.toMatch(/\?\.|\.\.\.|=>|\bconst\b|\blet\b/);
    const run = new Function(`${NATIVE_INDENTED_BLOCK_HELPERS_SCRIPT}; return [
      isNativeIndentedListLine('  - child'),
      isNativeIndentedListLine('- parent')
    ];`);
    expect(run()).toEqual([true, false]);
  });

  it('does not forward initial ready markdown as an edit', () => {
    expect(shouldForwardNativeMarkdownMessage({ type: 'ready', markdown: 'first line\n\nsecond line' }, 'first line\nsecond line')).toBe(false);
  });

  it('resyncs authoritative Markdown when ready reports blank or stale content', () => {
    expect(decideNativeMarkdownMessage({ type: 'ready' }, 'saved body')).toEqual({
      type: 'resync',
      markdown: 'saved body',
    });
    expect(decideNativeMarkdownMessage({ type: 'ready', markdown: '' }, 'saved body')).toEqual({
      type: 'resync',
      markdown: 'saved body',
    });
    expect(decideNativeMarkdownMessage({ type: 'ready', markdown: 'old body' }, 'saved body')).toEqual({
      type: 'resync',
      markdown: 'saved body',
    });
  });

  it('acknowledges matching initial content without treating it as an edit', () => {
    expect(decideNativeMarkdownMessage({ type: 'ready', markdown: 'saved body' }, 'saved body')).toEqual({
      type: 'acknowledge',
      markdown: 'saved body',
    });
  });

  it('never accepts programmatic sync echoes as user edits', () => {
    expect(decideNativeMarkdownMessage({
      type: 'content',
      reason: 'sync',
      markdown: 'saved body',
    }, 'saved body')).toEqual({
      type: 'acknowledge',
      markdown: 'saved body',
    });
    expect(decideNativeMarkdownMessage({
      type: 'content',
      reason: 'sync',
      markdown: 'stale body',
    }, 'newer body')).toEqual({
      type: 'resync',
      markdown: 'newer body',
    });
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
