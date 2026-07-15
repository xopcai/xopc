import type { Message } from './types.js';
import type { TranscriptStoredRow } from './session-context-for-llm.js';
import { buildTranscriptOutline } from './transcript-outline.js';

/** Transcript row for TUI and HTTP clients (flattened from persisted session messages). */
export interface ClientHistoryMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  displayIndex?: number;
  rawContent?: string | unknown[];
  timestamp?: number;
  kind?: 'message' | 'compaction' | 'context' | 'bash' | 'custom' | 'branch';
  tokensBefore?: number;
  tokensAfter?: number;
  bash?: {
    command: string;
    output?: string;
    exitCode?: number | null;
    signal?: string | null;
    excludeFromContext?: boolean;
    truncated?: boolean;
    fullOutputPath?: string;
  };
  custom?: {
    customType: string;
    details?: unknown;
    state?: boolean;
    display?: boolean;
  };
  branch?: {
    summary: string;
    fromId?: string;
  };
  toolCalls?: Array<{ id?: string; name: string; args?: unknown; result?: string; isError?: boolean }>;
}

export function flattenMessageContent(content: string | unknown[]): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') {
      parts.push(b.text);
    }
  }
  return parts.join('');
}

function parseTimestamp(ts: string | undefined): number | undefined {
  if (!ts) return undefined;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : undefined;
}

function safeJsonParseArguments(raw: string): unknown {
  const t = raw.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return raw;
  }
}

function collectToolResults(messages: Message[]): Map<string, { text: string; isError?: boolean }> {
  const map = new Map<string, { text: string; isError?: boolean }>();
  for (const m of messages) {
    if (m.role !== 'tool' && m.role !== 'toolResult') continue;
    const id = m.tool_call_id;
    if (!id || typeof id !== 'string') continue;
    map.set(id, {
      text: flattenMessageContent(m.content),
      isError: m.isError,
    });
  }
  return map;
}

function toolCallsWithResults(
  tool_calls: Message['tool_calls'],
  results: Map<string, { text: string; isError?: boolean }>,
): ClientHistoryMessage['toolCalls'] | undefined {
  if (!tool_calls?.length) return undefined;
  const out: NonNullable<ClientHistoryMessage['toolCalls']> = [];
  for (const tc of tool_calls) {
    const res = results.get(tc.id);
    out.push({
      id: tc.id,
      name: tc.function.name,
      args: safeJsonParseArguments(tc.function.arguments),
      result: res?.text,
      isError: res?.isError,
    });
  }
  return out.length ? out : undefined;
}

/**
 * Maps gateway/session API messages into a linear chat history for clients.
 * Tool / toolResult rows are merged into assistant `toolCalls` when ids match; otherwise skipped.
 */
export function messagesToClientHistory(
  messages: Message[],
  opts?: { limit?: number },
): ClientHistoryMessage[] {
  const slice =
    opts?.limit !== undefined && messages.length > opts.limit
      ? messages.slice(-opts.limit)
      : messages;

  const results = collectToolResults(slice);
  const out: ClientHistoryMessage[] = [];

  for (const m of slice) {
    if (m.role === 'tool' || m.role === 'toolResult') {
      continue;
    }

    if (m.role === 'user' || m.role === 'system') {
      const text = flattenMessageContent(m.content);
      out.push({
        role: m.role,
        content: text,
        timestamp: parseTimestamp(m.timestamp),
      });
      continue;
    }

    if (m.role === 'assistant') {
      const text = flattenMessageContent(m.content);
      const toolCalls = toolCallsWithResults(m.tool_calls, results);
      out.push({
        role: 'assistant',
        content: text,
        timestamp: parseTimestamp(m.timestamp),
        toolCalls,
      });
    }
  }

  return out;
}

type HistoryMessageRow = {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'toolResult';
  content?: string | unknown[];
  timestamp?: string | number;
  tool_call_id?: string;
  toolCallId?: string;
  tool_calls?: Message['tool_calls'];
  toolCalls?: Message['tool_calls'];
  isError?: boolean;
};

function asHistoryMessageRow(row: TranscriptStoredRow): HistoryMessageRow | null {
  const role = (row as { role?: unknown }).role;
  if (
    typeof role !== 'string' ||
    !['system', 'user', 'assistant', 'tool', 'toolResult'].includes(role)
  ) {
    return null;
  }
  return row as unknown as HistoryMessageRow;
}

function parseTimestampValue(ts: string | number | undefined): number | undefined {
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : undefined;
  return parseTimestamp(ts);
}

function collectHistoryToolResults(messages: HistoryMessageRow[]): Map<string, { text: string; isError?: boolean }> {
  const map = new Map<string, { text: string; isError?: boolean }>();
  for (const m of messages) {
    if (m.role !== 'tool' && m.role !== 'toolResult') continue;
    const id = m.tool_call_id ?? m.toolCallId;
    if (!id || typeof id !== 'string') continue;
    map.set(id, {
      text: flattenMessageContent(m.content ?? ''),
      isError: m.isError,
    });
  }
  return map;
}

function isCompactionRow(row: TranscriptStoredRow): row is TranscriptStoredRow & {
  type: 'compaction';
  summary?: string;
  at?: string;
  tokensBefore?: number;
  tokensAfter?: number;
} {
  return (row as { type?: unknown }).type === 'compaction';
}

function compactionSummaryRowToClientHistory(row: TranscriptStoredRow): ClientHistoryMessage | null {
  const r = row as unknown as Record<string, unknown>;
  if (r.role !== 'compactionSummary') return null;
  const summary = optionalString(r.summary) ?? '';
  return {
    role: 'system',
    kind: 'compaction',
    content: summary,
    timestamp: parseTimestampValue(
      typeof r.timestamp === 'string' || typeof r.timestamp === 'number' ? r.timestamp : undefined,
    ),
    tokensBefore: typeof r.tokensBefore === 'number' ? r.tokensBefore : undefined,
  };
}

function contextRowToClientHistory(row: TranscriptStoredRow): ClientHistoryMessage | null {
  if ((row as { kind?: unknown }).kind !== 'context') return null;
  const text = (row as { text?: unknown }).text;
  if (typeof text !== 'string' || !text.trim()) return null;
  const createdAt = (row as { createdAt?: unknown }).createdAt;
  return {
    role: 'system',
    kind: 'context',
    content: text,
    timestamp: typeof createdAt === 'string' ? parseTimestamp(createdAt) : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function reviewTraceRowToClientHistory(row: TranscriptStoredRow): {
  event: 'tool_start' | 'tool_end';
  toolCallId: string;
  toolName: string;
  input?: unknown;
  resultPreview?: string;
  isError?: boolean;
  timestamp?: number;
} | null {
  if ((row as { kind?: unknown }).kind !== 'context') return null;
  const data = asRecord((row as { data?: unknown }).data);
  if (data?.type !== 'review_trace' || data.scope !== 'review') return null;
  const event = data.event === 'tool_end'
    ? 'tool_end'
    : data.event === 'tool_start'
      ? 'tool_start'
      : null;
  if (!event) return null;
  const toolCallId = optionalString(data.toolCallId);
  const toolName = optionalString(data.toolName);
  if (!toolCallId || !toolName) return null;
  const createdAt = (row as { createdAt?: unknown }).createdAt;
  return {
    event,
    toolCallId,
    toolName,
    input: data.input,
    resultPreview: optionalString(data.resultPreview),
    isError: data.isError === true || data.status === 'error',
    timestamp: typeof createdAt === 'string' ? parseTimestamp(createdAt) : undefined,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function rawReviewContent(content: unknown): unknown[] | undefined {
  if (!Array.isArray(content)) return undefined;
  return content.some((block) => asRecord(block)?.type === 'review') ? content : undefined;
}

function bashRowToClientHistory(row: TranscriptStoredRow): ClientHistoryMessage | null {
  const r = row as unknown as Record<string, unknown>;
  if (r.role !== 'bashExecution') return null;

  const command = optionalString(r.command) ?? optionalString(r.content)?.trim();
  if (!command) return null;
  const output = Array.isArray(r.output) || typeof r.output === 'string'
    ? flattenMessageContent(r.output)
    : optionalString(r.output);
  const exitCode = typeof r.exitCode === 'number' ? r.exitCode : r.exitCode === null ? null : undefined;
  const signal = typeof r.signal === 'string' ? r.signal : r.signal === null ? null : undefined;
  const excludeFromContext =
    typeof r.excludeFromContext === 'boolean'
      ? r.excludeFromContext
      : typeof r.excludedFromContext === 'boolean'
        ? r.excludedFromContext
        : undefined;

  return {
    role: 'system',
    kind: 'bash',
    content: output || command,
    timestamp: parseTimestampValue(
      typeof r.timestamp === 'string' || typeof r.timestamp === 'number' ? r.timestamp : undefined,
    ),
    bash: {
      command,
      output,
      exitCode,
      signal,
      excludeFromContext,
      truncated: typeof r.truncated === 'boolean' ? r.truncated : undefined,
      fullOutputPath: optionalString(r.fullOutputPath),
    },
  };
}

function customRowToClientHistory(row: TranscriptStoredRow): ClientHistoryMessage | null {
  const r = row as unknown as Record<string, unknown>;
  if (r.role !== 'custom' && r.type !== 'custom_message') return null;

  const customType = optionalString(r.customType)?.trim();
  if (!customType) return null;
  const content = Array.isArray(r.content) || typeof r.content === 'string'
    ? flattenMessageContent(r.content)
    : '';
  const timestamp = parseTimestampValue(
    typeof r.timestamp === 'string' || typeof r.timestamp === 'number' ? r.timestamp : undefined,
  );

  return {
    role: 'system',
    kind: 'custom',
    content,
    rawContent: Array.isArray(r.content) || typeof r.content === 'string' ? r.content : undefined,
    timestamp,
    custom: {
      customType,
      details: r.details,
      display: r.display === false ? false : true,
    },
  };
}

function customStateRowToClientHistory(row: TranscriptStoredRow): ClientHistoryMessage | null {
  const r = row as unknown as Record<string, unknown>;
  if (r.type !== 'custom') return null;

  const customType = optionalString(r.customType)?.trim();
  if (!customType) return null;
  return {
    role: 'system',
    kind: 'custom',
    content: '',
    timestamp: parseTimestampValue(
      typeof r.timestamp === 'string' || typeof r.timestamp === 'number' ? r.timestamp : undefined,
    ),
    custom: {
      customType,
      details: r.data,
      state: true,
    },
  };
}

function branchSummaryRowToClientHistory(row: TranscriptStoredRow): ClientHistoryMessage | null {
  const r = row as unknown as Record<string, unknown>;
  if (r.role !== 'branchSummary') return null;
  const summary = optionalString(r.summary)?.trim();
  if (!summary) return null;
  const fromId = optionalString(r.fromId);

  return {
    role: 'system',
    kind: 'branch',
    content: summary,
    timestamp: parseTimestampValue(
      typeof r.timestamp === 'string' || typeof r.timestamp === 'number' ? r.timestamp : undefined,
    ),
    branch: {
      summary,
      fromId,
    },
  };
}

/**
 * Maps persisted transcript rows into linear chat history, preserving non-LLM
 * audit rows that the TUI can render as dedicated components.
 */
export function transcriptRowsToClientHistory(
  rows: TranscriptStoredRow[],
  opts?: { limit?: number; startRowNumber?: number; endRowNumber?: number },
): ClientHistoryMessage[] {
  const displayIndexByRowNumber = new Map(
    buildTranscriptOutline(rows)
      .filter((entry) => entry.displayIndex !== undefined)
      .map((entry) => [entry.rowNumber, entry.displayIndex!] as const),
  );
  const hasRowWindow = opts?.startRowNumber !== undefined || opts?.endRowNumber !== undefined;
  const startIndex = hasRowWindow
    ? Math.max(0, Math.trunc(opts?.startRowNumber ?? 1) - 1)
    : opts?.limit !== undefined && rows.length > opts.limit
      ? rows.length - opts.limit
      : 0;
  const endIndex = hasRowWindow
    ? Math.max(
        startIndex,
        Math.min(rows.length, Math.trunc(opts?.endRowNumber ?? rows.length)),
      )
    : rows.length;
  const slice = hasRowWindow
    ? rows.slice(startIndex, endIndex)
    : opts?.limit !== undefined && rows.length > opts.limit
      ? rows.slice(-opts.limit)
      : rows;
  const messages = slice
    .map(asHistoryMessageRow)
    .filter((row): row is HistoryMessageRow => row !== null);
  const results = collectHistoryToolResults(messages);
  const out: ClientHistoryMessage[] = [];
  const reviewTraceToolById = new Map<string, NonNullable<ClientHistoryMessage['toolCalls']>[number]>();

  for (const [offset, row] of slice.entries()) {
    const rowNumber = startIndex + offset + 1;
    const id = `row-${rowNumber}`;
    const displayIndex = displayIndexByRowNumber.get(rowNumber);
    if (isCompactionRow(row)) {
      out.push({
        id,
        role: 'system',
        kind: 'compaction',
        content: typeof row.summary === 'string' ? row.summary : '',
        ...(displayIndex !== undefined ? { displayIndex } : {}),
        timestamp: parseTimestamp(row.at),
        tokensBefore: row.tokensBefore,
        tokensAfter: row.tokensAfter,
      });
      continue;
    }

    const compactionSummaryRow = compactionSummaryRowToClientHistory(row);
    if (compactionSummaryRow) {
      out.push({
        id,
        ...compactionSummaryRow,
        ...(displayIndex !== undefined ? { displayIndex } : {}),
      });
      continue;
    }

    const reviewTraceRow = reviewTraceRowToClientHistory(row);
    if (reviewTraceRow) {
      const existing = reviewTraceToolById.get(reviewTraceRow.toolCallId);
      if (reviewTraceRow.event === 'tool_end' && existing) {
        existing.result = reviewTraceRow.resultPreview ?? '';
        existing.isError = reviewTraceRow.isError;
        continue;
      }
      const toolCall: NonNullable<ClientHistoryMessage['toolCalls']>[number] = {
        id: reviewTraceRow.toolCallId,
        name: reviewTraceRow.toolName,
        args: reviewTraceRow.input,
        ...(reviewTraceRow.event === 'tool_end' ? { result: reviewTraceRow.resultPreview ?? '' } : {}),
        ...(reviewTraceRow.isError ? { isError: true } : {}),
      };
      reviewTraceToolById.set(reviewTraceRow.toolCallId, toolCall);
      out.push({
        id,
        role: 'assistant',
        content: '',
        timestamp: reviewTraceRow.timestamp,
        toolCalls: [toolCall],
        ...(displayIndex !== undefined ? { displayIndex } : {}),
      });
      continue;
    }

    const contextRow = contextRowToClientHistory(row);
    if (contextRow) {
      out.push({
        id,
        ...contextRow,
        ...(displayIndex !== undefined ? { displayIndex } : {}),
      });
      continue;
    }

    const bashRow = bashRowToClientHistory(row);
    if (bashRow) {
      out.push({
        id,
        ...bashRow,
        ...(displayIndex !== undefined ? { displayIndex } : {}),
      });
      continue;
    }

    const customRow = customRowToClientHistory(row);
    if (customRow) {
      out.push({
        id,
        ...customRow,
        ...(displayIndex !== undefined ? { displayIndex } : {}),
      });
      continue;
    }

    const customStateRow = customStateRowToClientHistory(row);
    if (customStateRow) {
      out.push({
        id,
        ...customStateRow,
        ...(displayIndex !== undefined ? { displayIndex } : {}),
      });
      continue;
    }

    const branchSummaryRow = branchSummaryRowToClientHistory(row);
    if (branchSummaryRow) {
      out.push({
        id,
        ...branchSummaryRow,
        ...(displayIndex !== undefined ? { displayIndex } : {}),
      });
      continue;
    }

    const messageRow = asHistoryMessageRow(row);
    if (!messageRow) continue;
    if (messageRow.role === 'tool' || messageRow.role === 'toolResult') {
      continue;
    }

    if (messageRow.role === 'user' || messageRow.role === 'system') {
      out.push({
        id,
        role: messageRow.role,
        kind: 'message',
        content: flattenMessageContent(messageRow.content ?? ''),
        ...(displayIndex !== undefined ? { displayIndex } : {}),
        timestamp: parseTimestampValue(messageRow.timestamp),
      });
      continue;
    }

    const rawContent = rawReviewContent(messageRow.content);
    out.push({
      id,
      role: 'assistant',
      kind: 'message',
      content: flattenMessageContent(messageRow.content ?? ''),
      ...(rawContent ? { rawContent } : {}),
      ...(displayIndex !== undefined ? { displayIndex } : {}),
      timestamp: parseTimestampValue(messageRow.timestamp),
      toolCalls: toolCallsWithResults(messageRow.tool_calls ?? messageRow.toolCalls, results),
    });
  }

  return out;
}
