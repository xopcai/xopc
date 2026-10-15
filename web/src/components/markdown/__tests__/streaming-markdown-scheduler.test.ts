import { describe, expect, it } from 'vitest';

import {
  classifyStreamingMarkdownTail,
  AdaptiveStreamingMarkdownPacer,
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
    ).toBe(50);
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

  it('tracks sustained arrival speed instead of using a fixed character step', () => {
    const simulate = (arrivalSize: number) => {
      const pacer = new AdaptiveStreamingMarkdownPacer(0);
      let content = '';
      let visible = 0;
      const steps: number[] = [];
      for (let now = 50; now <= 2000; now += 50) {
        content += 'x'.repeat(arrivalSize);
        pacer.observe(content.length, now);
        const next = pacer.nextLength(visible, content, now);
        steps.push(next - visible);
        visible = next;
      }
      return steps.slice(-10).reduce((sum, step) => sum + step, 0);
    };
    expect(simulate(12)).toBeGreaterThan(simulate(2) * 3);
  });

  it('smooths a large burst without flushing everything at 250ms and eventually catches up', () => {
    const pacer = new AdaptiveStreamingMarkdownPacer(0);
    const content = 'x'.repeat(1600);
    pacer.observe(content.length, 0);
    let visible = 0;
    const commits: number[] = [];
    for (let now = 50; now <= 300; now += 50) {
      visible = pacer.nextLength(visible, content, now);
      commits.push(visible);
    }
    expect(commits[0]).toBeGreaterThan(0);
    expect(commits[0]).toBeLessThan(200);
    expect(visible).toBeLessThan(content.length);
    expect(new Set(commits).size).toBe(commits.length);
    for (let now = 350; now <= 4000; now += 50) visible = pacer.nextLength(visible, content, now);
    expect(visible).toBe(content.length);
  });

  it('does not bank idle time or replay speed from a previous response after reset', () => {
    const pacer = new AdaptiveStreamingMarkdownPacer(0);
    pacer.observe(10_000, 0);
    pacer.nextLength(0, 'x'.repeat(10_000), 100);
    pacer.reset(3);
    pacer.observe(103, 10_000);
    const next = pacer.nextLength(3, 'x'.repeat(103), 10_050);
    expect(next).toBeGreaterThan(3);
    expect(next).toBeLessThan(20);
  });

  it('never splits an emoji or combining grapheme and keeps fractional progress moving', () => {
    const pacer = new AdaptiveStreamingMarkdownPacer(0);
    const content = 'a👨‍👩‍👧‍👦e\u0301tail';
    pacer.observe(content.length, 0);
    let visible = 0;
    for (let now = 10; now <= 1000; now += 10) {
      visible = pacer.nextLength(visible, content, now);
      expect([0, 1, 12, 14, 15, 16, 17, 18]).toContain(visible);
    }
    expect(visible).toBe(content.length);
  });
});
