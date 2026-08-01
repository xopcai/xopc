import { describe, expect, it } from 'vitest';

import {
  classifyStreamingMarkdownTail,
  nextStreamingMarkdownCommitLength,
  streamingMarkdownCommitDelayMs,
  streamingMarkdownCommitIntervalMs,
} from '@/components/markdown/streaming-markdown-scheduler';

describe('streaming Markdown scheduler', () => {
  it('classifies expensive active Markdown blocks', () => {
    expect(classifyStreamingMarkdownTail('Writing normally')).toBe('plain');
    expect(classifyStreamingMarkdownTail('- one\n- two')).toBe('list');
    expect(classifyStreamingMarkdownTail('| A | B |\n| --- | --- |')).toBe('table');
    expect(classifyStreamingMarkdownTail('```ts\nconst value = 1')).toBe('code');
    expect(classifyStreamingMarkdownTail('x'.repeat(4_096))).toBe('long_text');
  });

  it('slows expensive tails and applies parse backpressure', () => {
    expect(
      streamingMarkdownCommitIntervalMs({ tailKind: 'plain', latestParseMs: 4 }),
    ).toBe(32);
    expect(
      streamingMarkdownCommitIntervalMs({ tailKind: 'table', latestParseMs: 4 }),
    ).toBe(72);
    expect(
      streamingMarkdownCommitIntervalMs({ tailKind: 'plain', latestParseMs: 30 }),
    ).toBe(60);
    expect(
      streamingMarkdownCommitIntervalMs({ tailKind: 'code', latestParseMs: 90 }),
    ).toBe(120);
  });

  it('aggregates the first fragment and preserves the steady commit cadence', () => {
    expect(
      streamingMarkdownCommitDelayMs({ intervalMs: 32, elapsedMs: 0, firstCommit: true }),
    ).toBe(48);
    expect(
      streamingMarkdownCommitDelayMs({ intervalMs: 120, elapsedMs: 0, firstCommit: true }),
    ).toBe(120);
    expect(
      streamingMarkdownCommitDelayMs({ intervalMs: 32, elapsedMs: 12, firstCommit: false }),
    ).toBe(20);
    expect(
      streamingMarkdownCommitDelayMs({ intervalMs: 32, elapsedMs: 48, firstCommit: false }),
    ).toBe(0);
  });

  it('reveals short replies visibly and bounds renders for large replies', () => {
    expect(
      nextStreamingMarkdownCommitLength({ visibleLength: 0, pendingContent: 'abcdefghijkl' }),
    ).toBe(6);
    expect(
      nextStreamingMarkdownCommitLength({ visibleLength: 6, pendingContent: 'abcdefghijkl' }),
    ).toBe(12);
    expect(
      nextStreamingMarkdownCommitLength({ visibleLength: 0, pendingContent: 'x'.repeat(1_600) }),
    ).toBe(100);
    expect(
      nextStreamingMarkdownCommitLength({ visibleLength: 0, pendingContent: 'x'.repeat(20_000) }),
    ).toBe(512);
  });

  it('never splits a surrogate pair between visible commits', () => {
    const pendingContent = 'abcde😀tail';
    expect(nextStreamingMarkdownCommitLength({ visibleLength: 0, pendingContent })).toBe(7);
  });
});
