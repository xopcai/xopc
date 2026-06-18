import { describe, expect, it } from 'vitest';

import type { TranscriptStoredRow } from '../../session/session-context-for-llm.js';
import { computeTuiSessionStats } from '../tui-session-stats.js';

describe('computeTuiSessionStats', () => {
  it('counts transcript rows, tool activity, and token usage', () => {
    const rows = [
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: 'checking',
        tool_calls: [{ id: 'tool-1' }, { id: 'tool-2' }],
        usage: { inputTokens: 12, outputTokens: 8, cacheReadTokens: 5, cacheWriteTokens: 3, totalTokens: 28 },
      },
      { role: 'tool', content: 'result' },
      { kind: 'context', type: 'compaction', content: 'summary' },
      {
        role: 'assistant',
        content: 'done',
        usage: { input: 4, output: 6, cacheRead: 2, cacheWrite: 1 },
      },
    ] as unknown as TranscriptStoredRow[];

    expect(computeTuiSessionStats(rows)).toEqual({
      totalMessages: 5,
      userMessages: 1,
      assistantMessages: 2,
      toolCalls: 2,
      toolResults: 1,
      contextRows: 1,
      tokens: {
        input: 16,
        output: 14,
        cacheRead: 7,
        cacheWrite: 4,
        total: 41,
      },
    });
  });
});
