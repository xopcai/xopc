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
const CODING_CONTEXT_LOOKBACK = 80;
const CODING_CONTEXT_MAX_LINES = 24;

function isLikelyAgentMessage(x: unknown): x is AgentMessage {
  if (!x || typeof x !== 'object') return false;
  const role = (x as Record<string, unknown>).role;
  return typeof role === 'string' && LLM_ROLES.has(role);
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

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      const rec = asRecord(part);
      if (!rec) return '';
      if (rec.type === 'text' && typeof rec.text === 'string') return rec.text;
      return '';
    })
    .filter(Boolean)
    .join('');
}

function toolNameFromBlock(block: Record<string, unknown>): string {
  const fn = asRecord(block.function);
  return stringValue(block.name) ?? stringValue(block.toolName) ?? stringValue(fn?.name) ?? 'tool';
}

function toolArgsFromBlock(block: Record<string, unknown>): Record<string, unknown> {
  const fn = asRecord(block.function);
  return (
    asRecord(block.arguments) ??
    asRecord(block.args) ??
    asRecord(block.input) ??
    asRecord(fn?.arguments) ??
    parseJsonRecord(block.arguments) ??
    parseJsonRecord(block.args) ??
    parseJsonRecord(block.input) ??
    parseJsonRecord(fn?.arguments) ??
    {}
  );
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

function extractResultDetails(row: AgentMessage | undefined): Record<string, unknown> | null {
  if (!row) return null;
  const topLevelDetails = asRecord((row as unknown as { details?: unknown }).details);
  if (topLevelDetails) return topLevelDetails;

  const contentText = textFromContent((row as { content?: unknown }).content);
  if (!contentText.trim()) return null;
  try {
    const parsed = JSON.parse(contentText) as unknown;
    const rec = asRecord(parsed);
    const details = asRecord(rec?.details);
    return details ?? rec;
  } catch {
    return null;
  }
}

function collectToolResults(messages: AgentMessage[]): Map<string, AgentMessage> {
  const results = new Map<string, AgentMessage>();
  for (const message of messages) {
    const role = (message as { role?: unknown }).role;
    if (role !== 'tool' && role !== 'toolResult') continue;
    const id = toolResultId(message);
    if (id) results.set(id, message);
  }
  return results;
}

function extractToolCalls(message: AgentMessage): Array<{ id?: string; name: string; args: Record<string, unknown> }> {
  const content = (message as { content?: unknown }).content;
  const calls: Array<{ id?: string; name: string; args: Record<string, unknown> }> = [];
  if (Array.isArray(content)) {
    for (const block of content) {
      const rec = asRecord(block);
      const type = rec ? stringValue(rec.type) : undefined;
      if (!rec || (type !== 'toolCall' && type !== 'tool_use' && type !== 'tool_call')) continue;
      calls.push({ id: toolCallIdFromBlock(rec), name: toolNameFromBlock(rec), args: toolArgsFromBlock(rec) });
    }
  }
  const toolCalls = (message as { tool_calls?: unknown }).tool_calls;
  if (Array.isArray(toolCalls)) {
    for (const call of toolCalls) {
      const rec = asRecord(call);
      const fn = asRecord(rec?.function);
      const name = stringValue(fn?.name) ?? stringValue(rec?.name);
      if (!rec || !name) continue;
      calls.push({
        id: stringValue(rec.id),
        name,
        args: parseJsonRecord(fn?.arguments) ?? asRecord(fn?.arguments) ?? {},
      });
    }
  }
  return calls;
}

function summarizePlan(details: Record<string, unknown>): string | undefined {
  const plan = Array.isArray(details.plan) ? details.plan : [];
  const lines = plan
    .map((item) => {
      const rec = asRecord(item);
      const step = stringValue(rec?.step)?.trim();
      const status = stringValue(rec?.status)?.trim();
      return step && status ? `${status}: ${step}` : '';
    })
    .filter(Boolean)
    .slice(0, 8);
  if (lines.length === 0) return undefined;
  const explanation = stringValue(details.explanation)?.trim();
  return `Plan${explanation ? ` (${explanation})` : ''}: ${lines.join(' | ')}`;
}

function summarizeCommand(args: Record<string, unknown>, details: Record<string, unknown> | null): string {
  const command = stringValue(details?.command) ?? stringValue(args.cmd) ?? stringValue(args.command) ?? '';
  const status = stringValue(details?.status) ?? (details?.exitCode === 0 ? 'success' : 'unknown');
  const exitCode = typeof details?.exitCode === 'number' ? details.exitCode : undefined;
  const hint = stringValue(details?.failureHint);
  return [
    `Command ${status}: ${command || '(unknown command)'}`,
    exitCode !== undefined ? `exit=${exitCode}` : '',
    hint ? `hint=${hint}` : '',
  ].filter(Boolean).join(' ');
}

function summarizePatch(details: Record<string, unknown> | null): string | undefined {
  if (!details) return undefined;
  const files = Array.isArray(details.files)
    ? details.files.filter((file): file is string => typeof file === 'string' && file.trim().length > 0)
    : [];
  const added = typeof details.added === 'number' ? details.added : 0;
  const removed = typeof details.removed === 'number' ? details.removed : 0;
  const summary = stringValue(details.summary)?.trim();
  return `Patch applied: ${files.length ? files.join(', ') : summary || '(files unknown)'} (+${added}/-${removed})`;
}

function buildCodingContextMessage(messages: AgentMessage[]): AgentMessage | null {
  const recent = messages.slice(-CODING_CONTEXT_LOOKBACK);
  const results = collectToolResults(recent);
  const lines: string[] = [];

  for (const message of recent) {
    if ((message as { role?: unknown }).role !== 'assistant') continue;
    for (const call of extractToolCalls(message)) {
      if (call.name !== 'update_plan' && call.name !== 'exec_command' && call.name !== 'apply_patch') {
        continue;
      }
      const result = call.id ? results.get(call.id) : undefined;
      const details = extractResultDetails(result);
      const line = call.name === 'update_plan'
        ? summarizePlan(details ?? call.args)
        : call.name === 'exec_command'
          ? summarizeCommand(call.args, details)
          : summarizePatch(details);
      if (line) lines.push(line);
    }
  }

  const uniqueLines = [...new Set(lines)].slice(-CODING_CONTEXT_MAX_LINES);
  if (uniqueLines.length === 0) return null;
  return {
    role: 'user',
    content: [{
      type: 'text',
      text: ['<coding_context>', ...uniqueLines.map((line) => `- ${line}`), '</coding_context>'].join('\n'),
    }],
  } as AgentMessage;
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
    if (isTranscriptContextEntry(r)) {
      continue;
    }
    if ((r as { type?: string }).type === 'compaction') {
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
  const codingContext = buildCodingContextMessage(out);
  if (codingContext) out.push(codingContext);
  return out;
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
