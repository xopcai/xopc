import { describe, it, expect } from 'vitest';
import { markdownBlocks } from '../entry/src/main/ets/common/markdown';
import { XopcMarkdownStreamParser } from '../entry/src/main/ets/common/markdownStreamParser';

describe('mobile chart fences', () => {
  it('requires a matching fence and retains the source language', () => {
    for (const source of ['````chart\n{}\n```', '~~~chart\n{}\n```', '```chart\n{}\n```text']) {
      expect(markdownBlocks(source)[0]).toMatchObject({ kind: 'code', language: 'chart' });
      expect(markdownBlocks(source)[0].closed).not.toBe(true);
    }
    expect(markdownBlocks('~~~chart\n{}\n~~~~')[0]).toMatchObject({ kind: 'code', language: 'chart', text: '{}', closed: true });
  });
  it('updates closed state across streamed chunks and sealed prefixes', () => {
    const parser = new XopcMarkdownStreamParser();
    expect(parser.parse('Before\n\n```chart\n{}')[1].closed).not.toBe(true);
    expect(parser.parse('Before\n\n```chart\n{}\n```\n\nAfter')[1].closed).toBe(true);
    expect(parser.parse('Before\n\n```chart\n{}\n```\n\nAfter now')[1].closed).toBe(true);
  });
});
