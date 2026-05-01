import type { Message } from './types.js';

/** Transcript row for TUI and HTTP clients (flattened from persisted session messages). */
export interface ClientHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  toolCalls?: Array<{ name: string; args?: unknown; result?: string; isError?: boolean }>;
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
