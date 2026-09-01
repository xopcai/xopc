import { createHash } from 'node:crypto';

export const CTX_HISTORY_SCHEMA_VERSION = 'ctx-history-jsonl-v2';
export const CTX_PROVIDER_KEY = 'xopc';
export const CTX_SOURCE_ID = 'default';
export const CTX_SOURCE_FORMAT = 'xopc-session-history-v1';

const EVENT_INDEX_STRIDE = 65_536;
const MAX_TEXT_CHUNK_BYTES = 1024 * 1024;
const MAX_JSONL_LINE_BYTES = 16 * 1024 * 1024;

export interface XopcHistorySession {
  sessionId: string;
  status: string;
  createdAt: number;
  archivedAt: number | null;
  cwd: string;
  agentId: string;
  sessionType: string | null;
  entries: XopcHistoryEntry[];
}

export interface XopcHistoryEntry {
  entryId: string;
  seq: number;
  createdAt: number;
  payloadJson: string;
}

interface NormalizedEvent {
  eventType: string;
  role?: 'user' | 'assistant' | 'tool';
  text: string;
  details?: Record<string, string | number | boolean | null>;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function timestamp(value: number, label: string): string {
  const date = new Date(value);
  if (!Number.isFinite(value) || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
  return date.toISOString();
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  return JSON.stringify(value) ?? '';
}

function textParts(content: unknown): string[] {
  if (typeof content === 'string') return content.length > 0 ? [content] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    const record = asRecord(block);
    return record?.type === 'text' && typeof record.text === 'string' && record.text.length > 0
      ? [record.text]
      : [];
  });
}

function outputText(output: unknown): string {
  if (typeof output === 'string') return output;
  return textParts(output).join('');
}

function toolCallDetails(block: JsonRecord): NormalizedEvent | null {
  const toolName = stringValue(block.name);
  if (!toolName) return null;
  const toolCallId = stringValue(block.id);
  const argumentsText = stringifyValue(block.arguments);
  const text = argumentsText ? `${toolName} ${argumentsText}` : toolName;
  return {
    eventType: 'tool_call',
    role: 'assistant',
    text,
    details: {
      tool_name: toolName,
      ...(toolCallId ? { tool_call_id: toolCallId } : {}),
    },
  };
}

function normalizeAssistant(row: JsonRecord): NormalizedEvent[] {
  if (typeof row.content === 'string') {
    return row.content.length > 0
      ? [{ eventType: 'message', role: 'assistant', text: row.content }]
      : [];
  }
  if (!Array.isArray(row.content)) return [];

  const events: NormalizedEvent[] = [];
  for (const block of row.content) {
    const record = asRecord(block);
    if (!record) continue;
    if (record.type === 'text' && typeof record.text === 'string' && record.text.length > 0) {
      events.push({ eventType: 'message', role: 'assistant', text: record.text });
      continue;
    }
    if (record.type === 'toolCall') {
      const event = toolCallDetails(record);
      if (event) events.push(event);
    }
  }
  return events;
}

function normalizeToolResult(row: JsonRecord): NormalizedEvent[] {
  const text = textParts(row.content).join('');
  if (!text) return [];
  const toolName = stringValue(row.toolName);
  const toolCallId = stringValue(row.toolCallId);
  return [{
    eventType: 'tool_output',
    role: 'tool',
    text,
    details: {
      ...(toolName ? { tool_name: toolName } : {}),
      ...(toolCallId ? { tool_call_id: toolCallId } : {}),
      ...(typeof row.isError === 'boolean' ? { is_error: row.isError } : {}),
    },
  }];
}

function normalizeBashExecution(row: JsonRecord): NormalizedEvent[] {
  const command = stringValue(row.command);
  if (!command) return [];
  const events: NormalizedEvent[] = [{
    eventType: 'command_started',
    role: 'user',
    text: command,
  }];
  const output = outputText(row.output);
  if (output) {
    events.push({ eventType: 'command_output', role: 'tool', text: output });
  }
  events.push({
    eventType: 'command_finished',
    role: 'tool',
    text: row.exitCode == null ? 'Command finished' : `Command exited with code ${String(row.exitCode)}`,
    details: {
      ...(typeof row.exitCode === 'number' ? { exit_code: row.exitCode } : {}),
      ...(typeof row.signal === 'string' ? { signal: row.signal } : {}),
      ...(typeof row.truncated === 'boolean' ? { truncated: row.truncated } : {}),
    },
  });
  return events;
}

function normalizeStoredRow(row: JsonRecord): NormalizedEvent[] {
  if (row.kind === 'context' || row.role === 'system') return [];
  if (row.type === 'compaction' && typeof row.summary === 'string' && row.summary.length > 0) {
    return [{ eventType: 'summary', role: 'assistant', text: row.summary }];
  }
  if (
    (row.role === 'branchSummary' || row.role === 'compactionSummary')
    && typeof row.summary === 'string'
    && row.summary.length > 0
  ) {
    return [{ eventType: 'summary', role: 'assistant', text: row.summary }];
  }
  if (row.role === 'bashExecution') return normalizeBashExecution(row);
  if (row.role === 'custom' || row.type === 'custom_message') {
    if (row.display === false) return [];
    return textParts(row.content).map((text) => ({ eventType: 'message', role: 'user', text }));
  }
  if (row.role === 'user') {
    return textParts(row.content).map((text) => ({ eventType: 'message', role: 'user', text }));
  }
  if (row.role === 'assistant') return normalizeAssistant(row);
  if (row.role === 'toolResult' || row.role === 'tool') return normalizeToolResult(row);
  return [];
}

function splitTextByUtf8Bytes(text: string): string[] {
  if (Buffer.byteLength(text, 'utf8') <= MAX_TEXT_CHUNK_BYTES) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let low = start + 1;
    let high = text.length;
    let end = low;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (Buffer.byteLength(text.slice(start, middle), 'utf8') <= MAX_TEXT_CHUNK_BYTES) {
        end = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const previous = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      end -= 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function stableEventId(sessionId: string, entryId: string, eventOffset: number): string {
  const digest = createHash('sha256')
    .update(sessionId)
    .update('\0')
    .update(entryId)
    .update('\0')
    .update(String(eventOffset))
    .digest('hex');
  return `xopc:${digest}`;
}

function serializeRecord(record: JsonRecord): string {
  const line = JSON.stringify(record);
  const size = Buffer.byteLength(line, 'utf8');
  if (size > MAX_JSONL_LINE_BYTES) {
    throw new Error(`ctx history record exceeds 16 MiB (${size} bytes)`);
  }
  return line;
}

function sessionRecord(session: XopcHistorySession): JsonRecord {
  const active = session.status === 'active';
  return {
    record_type: 'session',
    source_id: CTX_SOURCE_ID,
    provider_session_id: session.sessionId,
    started_at: timestamp(session.createdAt, `session timestamp for ${session.sessionId}`),
    external_agent_id: session.agentId,
    cwd: session.cwd,
    ...(session.archivedAt === null
      ? {}
      : { ended_at: timestamp(session.archivedAt, `session end timestamp for ${session.sessionId}`) }),
    status: active ? 'active' : 'completed',
    agent_scope: session.sessionType === 'workflow-subagent' ? 'subagent' : 'primary',
  };
}

function entryRecords(session: XopcHistorySession, entry: XopcHistoryEntry): JsonRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.payloadJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid transcript payload for entry ${entry.entryId}: ${message}`);
  }
  const row = asRecord(parsed);
  if (!row) throw new Error(`Transcript payload for entry ${entry.entryId} is not an object`);

  const occurredAt = timestamp(entry.createdAt, `entry timestamp for ${entry.entryId}`);
  const records: JsonRecord[] = [];
  let offset = 0;
  for (const event of normalizeStoredRow(row)) {
    const chunks = splitTextByUtf8Bytes(event.text);
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      if (offset >= EVENT_INDEX_STRIDE) {
        throw new Error(`Transcript entry ${entry.entryId} expands to too many ctx events`);
      }
      const eventIndex = entry.seq * EVENT_INDEX_STRIDE + offset;
      if (!Number.isSafeInteger(eventIndex) || eventIndex < 0) {
        throw new Error(`Transcript sequence is outside the supported range: ${entry.seq}`);
      }
      records.push({
        record_type: 'event',
        source_id: CTX_SOURCE_ID,
        provider_session_id: session.sessionId,
        event_index: eventIndex,
        event_id: stableEventId(session.sessionId, entry.entryId, offset),
        occurred_at: occurredAt,
        event_type: event.eventType,
        ...(event.role ? { role: event.role } : {}),
        payload: {
          text: chunks[chunkIndex],
          ...event.details,
          ...(chunks.length > 1 ? { chunk_index: chunkIndex, chunk_count: chunks.length } : {}),
        },
      });
      offset += 1;
    }
  }
  return records;
}

export function buildCtxHistoryJsonl(sessions: XopcHistorySession[]): {
  contents: string;
  eventCount: number;
} {
  const lines = [
    serializeRecord({
      record_type: 'manifest',
      schema_version: CTX_HISTORY_SCHEMA_VERSION,
      producer: 'xopc',
    }),
    serializeRecord({
      record_type: 'source',
      source_id: CTX_SOURCE_ID,
      provider_key: CTX_PROVIDER_KEY,
      source_format: CTX_SOURCE_FORMAT,
    }),
  ];
  let eventCount = 0;
  for (const session of sessions) {
    lines.push(serializeRecord(sessionRecord(session)));
    for (const entry of session.entries) {
      const records = entryRecords(session, entry);
      eventCount += records.length;
      lines.push(...records.map(serializeRecord));
    }
  }
  return { contents: `${lines.join('\n')}\n`, eventCount };
}

export function buildCtxPluginManifest(): string {
  return `${JSON.stringify({
    schema_version: 1,
    name: 'xopc',
    display_name: 'XOPC history',
    version: '1.0.0',
    history_sources: [{
      id: CTX_SOURCE_ID,
      provider_key: CTX_PROVIDER_KEY,
      source_id: CTX_SOURCE_ID,
      source_format: CTX_SOURCE_FORMAT,
      path: 'history.jsonl',
      enabled: true,
      refresh: 'manual',
    }],
  }, null, 2)}\n`;
}
