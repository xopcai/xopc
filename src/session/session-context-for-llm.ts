/**
 * Transcript rows persisted on disk may include non-LLM entries (e.g. `kind: 'context'`).
 * {@link buildSessionContextForLlm} is the single choke point for provider-facing history.
 *
 * Do not pass raw on-disk JSONL rows into pi-agent / providers — always run
 * {@link buildSessionContextForLlm} first (or use {@link SessionStore.loadMessages}, which already does).
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core';

/** Persisted-only row: never sent to the model as a chat message. */
export interface XopcTranscriptContextEntry {
  kind: 'context';
  id?: string;
  /** Short human-readable line for UIs / logs. */
  text?: string;
  /** Structured payload (tool summaries, delivery metadata, etc.). */
  data?: Record<string, unknown>;
  createdAt?: string;
}

/** Persisted-only row for replaying local shell executions in clients. */
export interface XopcTranscriptBashExecutionEntry {
  role: 'bashExecution';
  command?: string;
  output?: string | unknown[];
  exitCode?: number | null;
  signal?: string | null;
  excludeFromContext?: boolean;
  excludedFromContext?: boolean;
  truncated?: boolean;
  fullOutputPath?: string;
  timestamp?: string | number;
}

/** Persisted extension-injected message row for client replay. */
export interface XopcTranscriptCustomMessageEntry {
  role: 'custom';
  customType?: string;
  content?: string | unknown[];
  display?: boolean;
  details?: unknown;
  timestamp?: string | number;
}

/** Persisted extension custom_message entry shape before conversion to an agent message. */
export interface XopcTranscriptCustomMessageFileEntry {
  type: 'custom_message';
  customType?: string;
  content?: string | unknown[];
  display?: boolean;
  details?: unknown;
  timestamp?: string | number;
}

/** Persisted extension state entry for replay by extension sessionManager APIs. */
export interface XopcTranscriptCustomStateEntry {
  type: 'custom';
  customType?: string;
  data?: unknown;
  timestamp?: string | number;
}

/** Persisted branch summary row generated when returning from a branch. */
export interface XopcTranscriptBranchSummaryEntry {
  role: 'branchSummary';
  summary?: string;
  fromId?: string;
  timestamp?: string | number;
}

/** Persisted compaction summary row generated after transcript compaction. */
export interface XopcTranscriptCompactionSummaryEntry {
  role: 'compactionSummary';
  summary?: string;
  tokensBefore?: number;
  timestamp?: string | number;
}

/** Append-only compaction boundary containing the exact LLM context at that point. */
export interface XopcTranscriptCompactionEntry {
  type: 'compaction';
  at: string;
  baseSeq: number;
  plannerVersion: number;
  summaryModelRef: string;
  qualityAudit: 'passed' | 'disabled';
  summary: string;
  messages: AgentMessage[];
  firstKeptIndex: number;
  tokensBefore: number;
  tokensAfter: number;
  restoredFromCompactionId?: string;
}

/** Persisted label change for a transcript entry. */
export interface XopcTranscriptLabelEntry {
  type: 'label';
  id?: string;
  parentId?: string | null;
  targetId?: string;
  label?: string;
  timestamp?: string | number;
}

/** Persisted thinking level change metadata row. */
export interface XopcTranscriptThinkingLevelChangeEntry {
  type: 'thinking_level_change';
  id?: string;
  parentId?: string | null;
  thinkingLevel?: string;
  timestamp?: string | number;
}

/** Persisted model change metadata row. */
export interface XopcTranscriptModelChangeEntry {
  type: 'model_change';
  id?: string;
  parentId?: string | null;
  provider?: string;
  modelId?: string;
  timestamp?: string | number;
}

/** Persisted session info metadata row. */
export interface XopcTranscriptSessionInfoEntry {
  type: 'session_info';
  id?: string;
  parentId?: string | null;
  name?: string;
  timestamp?: string | number;
}

export type TranscriptStoredRow =
  | AgentMessage
  | XopcTranscriptContextEntry
  | XopcTranscriptBashExecutionEntry
  | XopcTranscriptCustomMessageEntry
  | XopcTranscriptCustomMessageFileEntry
  | XopcTranscriptCustomStateEntry
  | XopcTranscriptBranchSummaryEntry
  | XopcTranscriptCompactionSummaryEntry
  | XopcTranscriptCompactionEntry
  | XopcTranscriptLabelEntry
  | XopcTranscriptThinkingLevelChangeEntry
  | XopcTranscriptModelChangeEntry
  | XopcTranscriptSessionInfoEntry;

export function isTranscriptContextEntry(x: unknown): x is XopcTranscriptContextEntry {
  if (!x || typeof x !== 'object') return false;
  return (x as Record<string, unknown>).kind === 'context';
}

export function isTranscriptBashExecutionEntry(x: unknown): x is XopcTranscriptBashExecutionEntry {
  if (!x || typeof x !== 'object') return false;
  return (x as Record<string, unknown>).role === 'bashExecution';
}

export function isTranscriptCustomMessageEntry(
  x: unknown,
): x is XopcTranscriptCustomMessageEntry | XopcTranscriptCustomMessageFileEntry {
  if (!x || typeof x !== 'object') return false;
  const row = x as Record<string, unknown>;
  return row.role === 'custom' || row.type === 'custom_message';
}

export function isTranscriptCustomStateEntry(x: unknown): x is XopcTranscriptCustomStateEntry {
  if (!x || typeof x !== 'object') return false;
  return (x as Record<string, unknown>).type === 'custom';
}

export function isTranscriptSummaryMessageEntry(
  x: unknown,
): x is XopcTranscriptBranchSummaryEntry | XopcTranscriptCompactionSummaryEntry {
  if (!x || typeof x !== 'object') return false;
  const role = (x as Record<string, unknown>).role;
  return role === 'branchSummary' || role === 'compactionSummary';
}

export function isTranscriptCompactionEntry(x: unknown): x is XopcTranscriptCompactionEntry {
  if (!x || typeof x !== 'object') return false;
  const row = x as Record<string, unknown>;
  return row.type === 'compaction'
    && typeof row.at === 'string'
    && typeof row.baseSeq === 'number'
    && Number.isInteger(row.baseSeq)
    && typeof row.plannerVersion === 'number'
    && Number.isInteger(row.plannerVersion)
    && typeof row.summaryModelRef === 'string'
    && (row.qualityAudit === 'passed' || row.qualityAudit === 'disabled')
    && typeof row.summary === 'string'
    && Array.isArray(row.messages)
    && typeof row.firstKeptIndex === 'number'
    && typeof row.tokensBefore === 'number'
    && typeof row.tokensAfter === 'number';
}

export function isTranscriptLabelEntry(x: unknown): x is XopcTranscriptLabelEntry {
  if (!x || typeof x !== 'object') return false;
  return (x as Record<string, unknown>).type === 'label';
}

export function isTranscriptMetadataEntry(
  x: unknown,
): x is XopcTranscriptThinkingLevelChangeEntry | XopcTranscriptModelChangeEntry | XopcTranscriptSessionInfoEntry {
  if (!x || typeof x !== 'object') return false;
  const type = (x as Record<string, unknown>).type;
  return type === 'thinking_level_change' || type === 'model_change' || type === 'session_info';
}

const LLM_ROLES = new Set(['user', 'assistant', 'system', 'tool', 'toolResult']);

function isLikelyAgentMessage(x: unknown): x is AgentMessage {
  if (!x || typeof x !== 'object') return false;
  const role = (x as Record<string, unknown>).role;
  return typeof role === 'string' && LLM_ROLES.has(role);
}

/** Runtime-derived messages are never authoritative transcript rows. */
export function isRuntimeOnlyTranscriptMessage(x: unknown): boolean {
  return isLikelyAgentMessage(x) && (x as unknown as { droppable?: unknown }).droppable === true;
}

function parseTimestampValue(timestamp: string | number | undefined): number | undefined {
  if (typeof timestamp === 'number') {
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  if (typeof timestamp !== 'string') {
    return undefined;
  }
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : undefined;
}

function customMessageRowToLlmMessage(
  row: XopcTranscriptCustomMessageEntry | XopcTranscriptCustomMessageFileEntry,
): AgentMessage {
  const content = typeof row.content === 'string'
    ? [{ type: 'text' as const, text: row.content }]
    : Array.isArray(row.content)
      ? row.content
      : [{ type: 'text' as const, text: '' }];
  return {
    role: 'user',
    content,
    timestamp: parseTimestampValue(row.timestamp),
  } as AgentMessage;
}

function bashExecutionRowToLlmMessage(row: XopcTranscriptBashExecutionEntry): AgentMessage | null {
  if (row.excludeFromContext === true || row.excludedFromContext === true) {
    return null;
  }
  const command = row.command?.trim();
  if (!command) {
    return null;
  }
  const output = typeof row.output === 'string'
    ? row.output
    : Array.isArray(row.output)
      ? row.output
        .filter((part): part is { type: string; text?: string } =>
          typeof part === 'object' && part !== null && 'type' in part)
        .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
        .join('')
      : '';
  const exit = row.exitCode == null ? '?' : String(row.exitCode);
  const signal = row.signal ? ` signal=${row.signal}` : '';
  const truncated = row.truncated ? '\n[output truncated]' : '';
  return {
    role: 'user',
    content: [{
      type: 'text',
      text: [
        '<local_shell>',
        `$ ${command}`,
        `exit=${exit}${signal}`,
        output ? 'output:' : 'output: (empty)',
        output.trimEnd(),
        `${truncated}</local_shell>`,
      ].join('\n'),
    }],
    timestamp: parseTimestampValue(row.timestamp),
  } as AgentMessage;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toolCallIdFromBlock(block: Record<string, unknown>): string | undefined {
  return (
    stringValue(block.id) ??
    stringValue(block.toolCallId) ??
    stringValue(block.tool_call_id) ??
    stringValue(block.tool_call_id$)
  );
}

function toolResultId(row: AgentMessage): string | undefined {
  const rec = row as unknown as Record<string, unknown>;
  return (
    stringValue(rec.toolCallId) ??
    stringValue(rec.tool_call_id) ??
    stringValue(rec.tool_call_id$)
  );
}

function toolCallIds(message: AgentMessage): string[] {
  if (message.role !== 'assistant') return [];
  const ids: string[] = [];
  const content = (message as { content?: unknown }).content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const rec = asRecord(block);
      const type = rec ? stringValue(rec.type) : undefined;
      if (!rec || (type !== 'toolCall' && type !== 'tool_use' && type !== 'tool_call')) continue;
      const id = toolCallIdFromBlock(rec);
      if (id) ids.push(id);
    }
  }
  const calls = (message as { tool_calls?: unknown }).tool_calls;
  if (Array.isArray(calls)) {
    for (const call of calls) {
      const id = stringValue(asRecord(call)?.id);
      if (id) ids.push(id);
    }
  }
  return ids;
}

function filterAssistantToolCalls(message: AgentMessage, pairedIds: Set<string>): AgentMessage | null {
  const record = message as unknown as Record<string, unknown>;
  const content = record.content;
  const filteredContent = Array.isArray(content)
    ? content.filter((block) => {
        const rec = asRecord(block);
        const type = rec ? stringValue(rec.type) : undefined;
        if (!rec || (type !== 'toolCall' && type !== 'tool_use' && type !== 'tool_call')) return true;
        const id = toolCallIdFromBlock(rec);
        return id !== undefined && pairedIds.has(id);
      })
    : content;
  const toolCalls = record.tool_calls;
  const filteredToolCalls = Array.isArray(toolCalls)
    ? toolCalls.filter((call) => {
        const id = stringValue(asRecord(call)?.id);
        return id !== undefined && pairedIds.has(id);
      })
    : toolCalls;

  const hadArrayContent = Array.isArray(content);
  const hadToolCalls = Array.isArray(toolCalls);
  const hasContent = Array.isArray(filteredContent)
    ? filteredContent.length > 0
    : typeof filteredContent === 'string'
      ? filteredContent.trim().length > 0
      : filteredContent !== undefined && filteredContent !== null;
  const hasToolCalls = Array.isArray(filteredToolCalls) && filteredToolCalls.length > 0;
  if (!hasContent && !hasToolCalls) {
    return null;
  }
  return {
    ...record,
    ...(hadArrayContent ? { content: filteredContent } : {}),
    ...(hadToolCalls ? { tool_calls: filteredToolCalls } : {}),
  } as unknown as AgentMessage;
}

/** Providers require every retained tool call and result to form an ordered pair. */
function sanitizeToolPairs(messages: AgentMessage[]): AgentMessage[] {
  const callIndex = new Map<string, number>();
  const resultIndex = new Map<string, number>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    for (const id of toolCallIds(message)) {
      if (!callIndex.has(id)) callIndex.set(id, index);
    }
    const role = String((message as { role?: unknown }).role ?? '');
    if (role === 'tool' || role === 'toolResult') {
      const id = toolResultId(message);
      if (id && !resultIndex.has(id)) resultIndex.set(id, index);
    }
  }

  const pairedIds = new Set<string>();
  for (const [id, callAt] of callIndex) {
    const resultAt = resultIndex.get(id);
    if (resultAt !== undefined && resultAt > callAt) pairedIds.add(id);
  }

  const out: AgentMessage[] = [];
  for (const message of messages) {
    const role = String((message as { role?: unknown }).role ?? '');
    if (role === 'tool' || role === 'toolResult') {
      const id = toolResultId(message);
      if (id && pairedIds.has(id)) out.push(message);
      continue;
    }
    if (message.role === 'assistant') {
      const filtered = filterAssistantToolCalls(message, pairedIds);
      if (filtered) out.push(filtered);
      continue;
    }
    out.push(message);
  }
  return out;
}

/**
 * Normalize a JSON array from on-disk transcript into stored rows (drops unrecognized objects).
 */
export function transcriptRowsFromJsonArray(arr: unknown[]): TranscriptStoredRow[] {
  const out: TranscriptStoredRow[] = [];
  for (const x of arr) {
    if (isTranscriptContextEntry(x)) {
      out.push(x);
      continue;
    }
    if (isTranscriptBashExecutionEntry(x)) {
      out.push(x);
      continue;
    }
    if (isTranscriptCustomMessageEntry(x)) {
      out.push(x);
      continue;
    }
    if (isTranscriptCustomStateEntry(x)) {
      out.push(x);
      continue;
    }
    if (isTranscriptSummaryMessageEntry(x)) {
      out.push(x);
      continue;
    }
    if (isTranscriptCompactionEntry(x)) {
      out.push(x);
      continue;
    }
    if (isTranscriptLabelEntry(x)) {
      out.push(x);
      continue;
    }
    if (isTranscriptMetadataEntry(x)) {
      out.push(x);
      continue;
    }
    if (isLikelyAgentMessage(x)) {
      out.push(x);
    }
  }
  return out;
}

/** Messages only — what providers and pi-agent should see. */
export function buildSessionContextForLlm(rows: TranscriptStoredRow[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const r of rows) {
    if (isTranscriptCompactionEntry(r)) {
      out.length = 0;
      out.push(...r.messages);
      continue;
    }
    if (isTranscriptContextEntry(r)) {
      continue;
    }
    if (isTranscriptBashExecutionEntry(r)) {
      const msg = bashExecutionRowToLlmMessage(r);
      if (msg) out.push(msg);
      continue;
    }
    if (isTranscriptCustomMessageEntry(r)) {
      out.push(customMessageRowToLlmMessage(r));
      continue;
    }
    if (isLikelyAgentMessage(r)) {
      out.push(r);
    }
  }
  return sanitizeToolPairs(out);
}

/** Visible chat messages only - no LLM-only audit/context expansion. */
export function buildSessionDisplayMessages(rows: TranscriptStoredRow[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const r of rows) {
    if (isTranscriptCustomMessageEntry(r)) {
      if (r.display === false) {
        continue;
      }
      out.push(customMessageRowToLlmMessage(r));
      continue;
    }
    if (isLikelyAgentMessage(r)) {
      out.push(r);
    }
  }
  return out;
}

/**
 * When persisting LLM messages, keep prior `kind: 'context'` rows in their relative positions:
 * each non-context slot in the previous file is replaced by the next incoming LLM message;
 * trailing new LLM rows are appended. Extra old LLM rows are dropped if the new list is shorter.
 */
export function mergeLlmMessagesPreservingContextRows(
  prevRows: TranscriptStoredRow[],
  llmMessages: AgentMessage[],
): TranscriptStoredRow[] {
  let i = 0;
  const out: TranscriptStoredRow[] = [];
  for (const r of prevRows) {
    if (
      isTranscriptContextEntry(r) ||
      isTranscriptBashExecutionEntry(r) ||
      isTranscriptCustomMessageEntry(r) ||
      isTranscriptCustomStateEntry(r) ||
      isTranscriptSummaryMessageEntry(r) ||
      isTranscriptLabelEntry(r) ||
      isTranscriptMetadataEntry(r)
    ) {
      out.push(r);
    } else {
      if (i < llmMessages.length) {
        out.push(llmMessages[i]);
        i += 1;
      }
    }
  }
  while (i < llmMessages.length) {
    out.push(llmMessages[i]);
    i += 1;
  }
  return out;
}
