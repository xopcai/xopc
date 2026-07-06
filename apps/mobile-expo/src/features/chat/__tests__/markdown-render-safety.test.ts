import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  markdownContainsPipeTable,
  markdownNeedsPlainFallback,
  shouldUseMarkdownFallback,
} from '../markdown-render-safety';
import { parseSessionMessages, dedupeWireMessages, normalizeWireUsage } from '../session-message-parser';

const SESSION_PATH =
  '/Users/micjoyce/Downloads/session-agent_writer_webchat_default_direct_chat_1781318063943_361538.json';

describe('markdown-render-safety', () => {
  it('detects GFM pipe tables', () => {
    const table = [
      '| 时间 | 事件 |',
      '|------|------|',
      '| 2019 | Jack Dorsey 在 Twitter 内部发起 Bluesky 项目 |',
    ].join('\n');
    expect(markdownContainsPipeTable(table)).toBe(true);
    expect(markdownNeedsPlainFallback(`intro\n\n${table}\n\noutro`)).toBe(true);
  });

  it('allows simple markdown without tables', () => {
    const md = '## Title\n\n**bold** and a [link](https://example.com)';
    expect(markdownNeedsPlainFallback(md)).toBe(false);
  });

  it('uses the JS fallback on web even when the enriched renderer is available', () => {
    expect(
      shouldUseMarkdownFallback({
        content: '## Title\n\nsimple markdown',
        hasEnriched: true,
        platform: 'web',
      }),
    ).toBe(true);
  });

  it('uses the JS fallback when the enriched renderer is unavailable', () => {
    expect(
      shouldUseMarkdownFallback({
        content: '## Title\n\nsimple markdown',
        hasEnriched: false,
        platform: 'ios',
      }),
    ).toBe(true);
  });

  it('keeps simple native markdown on the enriched renderer', () => {
    expect(
      shouldUseMarkdownFallback({
        content: '## Title\n\nsimple markdown',
        hasEnriched: true,
        platform: 'ios',
      }),
    ).toBe(false);
  });
});

describe('normalizeWireUsage', () => {
  it('maps nested cost.total and input/output aliases', () => {
    expect(
      normalizeWireUsage({
        input: 321,
        output: 1072,
        totalTokens: 28017,
        cost: { total: 0.0004196472 },
      }),
    ).toEqual({
      inputTokens: 321,
      outputTokens: 1072,
      totalTokens: 28017,
      cost: 0.0004196472,
    });
  });
});

describe('session crash repro', () => {
  it('parses exported session without object cost usage', () => {
    if (!existsSync(SESSION_PATH)) return;
    const raw = JSON.parse(readFileSync(SESSION_PATH, 'utf8')) as {
      messages?: Array<Record<string, unknown>>;
    };
    const wire = raw.messages ?? [];
    const parsed = parseSessionMessages(dedupeWireMessages(wire));

    expect(parsed).toHaveLength(4);

    const assistantTexts = parsed
      .filter((m) => m.role === 'assistant')
      .map((m) =>
        m.content
          .filter((b) => b.type === 'text')
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('\n'),
      );

    const tableReply = assistantTexts.find((text) => markdownContainsPipeTable(text));
    expect(tableReply, `assistant texts: ${assistantTexts.map((t) => t.slice(0, 40))}`).toBeTruthy();
    expect(markdownNeedsPlainFallback(tableReply!)).toBe(true);

    for (const m of parsed) {
      const cost = m.usage?.cost;
      if (cost != null) {
        expect(typeof cost).toBe('number');
      }
    }
  });
});
