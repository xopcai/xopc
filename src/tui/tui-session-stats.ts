import type { TranscriptStoredRow } from '../session/session-context-for-llm.js';

import type { TuiSessionStats } from './tui-backend.js';

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function usageFromRow(row: Record<string, unknown>): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
} {
  const usage = row.usage && typeof row.usage === 'object'
    ? row.usage as Record<string, unknown>
    : {};
  const input = usageNumber(usage.input) + usageNumber(usage.inputTokens);
  const output = usageNumber(usage.output) + usageNumber(usage.outputTokens);
  const cacheRead = usageNumber(usage.cacheRead) + usageNumber(usage.cacheReadTokens);
  const cacheWrite = usageNumber(usage.cacheWrite) + usageNumber(usage.cacheWriteTokens);
  const explicitTotal = usageNumber(usage.total) + usageNumber(usage.totalTokens);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: explicitTotal || input + output + cacheRead + cacheWrite,
  };
}

export function computeTuiSessionStats(rows: TranscriptStoredRow[]): TuiSessionStats {
  const stats: TuiSessionStats = {
    totalMessages: rows.length,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    contextRows: 0,
    tokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };

  for (const row of rows) {
    const record = row as unknown as Record<string, unknown>;
    if (record.kind === 'context' || record.type === 'compaction') {
      stats.contextRows += 1;
      continue;
    }
    const role = typeof record.role === 'string' ? record.role : '';
    if (role === 'user') stats.userMessages += 1;
    else if (role === 'assistant') stats.assistantMessages += 1;
    else if (role === 'tool' || role === 'toolResult') stats.toolResults += 1;

    const toolCalls = Array.isArray(record.tool_calls)
      ? record.tool_calls.length
      : Array.isArray(record.toolCalls)
        ? record.toolCalls.length
        : 0;
    stats.toolCalls += toolCalls;

    const usage = usageFromRow(record);
    stats.tokens.input += usage.input;
    stats.tokens.output += usage.output;
    stats.tokens.cacheRead += usage.cacheRead;
    stats.tokens.cacheWrite += usage.cacheWrite;
    stats.tokens.total += usage.total;
  }

  return stats;
}
