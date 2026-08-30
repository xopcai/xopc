import type { AgentMessage } from '@earendil-works/pi-agent-core';

import {
  isTranscriptBashExecutionEntry,
  isTranscriptContextEntry,
  isTranscriptCustomMessageEntry,
  isTranscriptLabelEntry,
  isTranscriptMetadataEntry,
  isTranscriptSummaryMessageEntry,
  type TranscriptStoredRow,
} from './session-context-for-llm.js';
import { stripRuntimeContextFromUserMessage } from './user-message-display.js';

export type SessionTimelineItemKind =
  | 'turn'
  | 'tool'
  | 'file'
  | 'command'
  | 'context'
  | 'branch'
  | 'compaction';

export type SessionTimelineItem = {
  id: string;
  kind: SessionTimelineItemKind;
  role?: 'user' | 'assistant' | 'system';
  title: string;
  preview?: string;
  timestamp?: number;
  depth: number;
  turn: number;
  displayIndex?: number;
  rowNumber?: number;
  status?: 'running' | 'done' | 'error';
  meta?: { toolName?: string; files?: string[] };
};

export interface TranscriptOutlineEntry {
  id: string;
  parentId?: string;
  depth: number;
  label: string;
  role?: string;
  userLabel?: string;
  labelTimestamp?: string;
  turn: number;
  preview?: string;
  contentText?: string;
  toolCallPreview?: string;
  createdAt?: string;
  isOnActivePath?: boolean;
  isCurrentLeaf?: boolean;
  kind: SessionTimelineItemKind;
  title: string;
  timestamp?: number;
  displayIndex?: number;
  rowNumber: number;
  status?: 'running' | 'done' | 'error';
  meta?: { toolName?: string; files?: string[] };
}

interface ToolCallDisplay {
  name: string;
  preview: string;
  files: string[];
  kind: SessionTimelineItemKind;
  status?: 'running' | 'done' | 'error';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function truncateText(text: string, max = 96): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function contentPreview(content: unknown): string {
  return truncateText(contentText(content));
}

function contentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    const obj = asRecord(block);
    if (!obj) continue;
    const type = stringValue(obj.type);
    if (type === 'text') {
      parts.push(stringValue(obj.text) ?? '');
    } else if (type === 'toolCall' || type === 'tool_use' || type === 'tool_call') {
      parts.push(formatToolCallPreview(
        toolNameFromBlock(obj),
        toolArgsFromBlock(obj),
      ));
    } else if (type === 'image' || type === 'image_url') {
      parts.push('[image]');
    } else if (type) {
      parts.push(`[${type}]`);
    }
  }
  return parts.filter(Boolean).join(' ');
}

function collectFiles(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && /(?:^\.{0,2}\/|[\\/]|\.[a-zA-Z0-9]{1,8}$)/.test(trimmed)) {
      out.add(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFiles(item, out);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const key of ['path', 'file', 'filePath', 'file_path', 'targetFile', 'target_file']) {
    const file = stringValue(record[key]);
    if (file) out.add(file);
  }
  for (const key of ['files', 'paths']) {
    collectFiles(record[key], out);
  }
}

function filesFromArgs(args: Record<string, unknown>): string[] {
  const files = new Set<string>();
  collectFiles(args, files);
  return [...files].slice(0, 8);
}

function toolKind(name: string, files: readonly string[]): SessionTimelineItemKind {
  const normalized = name.toLowerCase().replace(/[-.]/g, '_');
  if (
    files.length > 0 ||
    normalized.includes('read') ||
    normalized.includes('write') ||
    normalized.includes('edit') ||
    normalized.includes('patch')
  ) {
    return 'file';
  }
  if (normalized.includes('bash') || normalized.includes('shell') || normalized.includes('command')) {
    return 'command';
  }
  return 'tool';
}

function formatToolCallPreview(name: string, args: Record<string, unknown>): string {
  const path = stringValue(args.path) ?? stringValue(args.file_path) ?? '';
  if (name === 'read' || name === 'read_file') {
    const offset = typeof args.offset === 'number' ? args.offset : undefined;
    const limit = typeof args.limit === 'number' ? args.limit : undefined;
    let display = path;
    if (offset !== undefined || limit !== undefined) {
      const start = offset ?? 1;
      const end = limit !== undefined ? start + limit - 1 : undefined;
      display += `:${start}${end !== undefined ? `-${end}` : ''}`;
    }
    return `[read: ${display || 'file'}]`;
  }
  if (name === 'write' || name === 'write_file') return `[write: ${path || 'file'}]`;
  if (name === 'edit') return `[edit: ${path || 'file'}]`;
  if (name === 'bash' || name === 'shell') {
    const rawCommand = stringValue(args.command) ?? '';
    const command = rawCommand.replace(/[\n\t]/g, ' ').trim();
    return `[bash: ${truncateText(command, 53)}]`;
  }
  if (name === 'grep') {
    const pattern = stringValue(args.pattern) ?? '';
    return `[grep: /${pattern}/ in ${path || '.'}]`;
  }
  if (name === 'find') {
    const pattern = stringValue(args.pattern) ?? '';
    return `[find: ${pattern} in ${path || '.'}]`;
  }
  if (name === 'ls') return `[ls: ${path || '.'}]`;
  const argsText = JSON.stringify(args);
  const truncatedArgs = argsText.length > 40 ? `${argsText.slice(0, 40)}...` : argsText;
  return `[${name}: ${truncatedArgs}]`;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function toolNameFromBlock(obj: Record<string, unknown>): string {
  const fn = asRecord(obj.function);
  return stringValue(obj.name) ?? stringValue(obj.toolName) ?? stringValue(fn?.name) ?? 'tool';
}

function toolArgsFromBlock(obj: Record<string, unknown>): Record<string, unknown> {
  const fn = asRecord(obj.function);
  return (
    asRecord(obj.arguments) ??
    asRecord(obj.args) ??
    asRecord(obj.input) ??
    asRecord(fn?.arguments) ??
    parseJsonRecord(obj.arguments) ??
    parseJsonRecord(obj.args) ??
    parseJsonRecord(obj.input) ??
    parseJsonRecord(fn?.arguments) ??
    {}
  );
}

function collectToolCallDisplays(content: unknown): Array<{ id: string } & ToolCallDisplay> {
  if (!Array.isArray(content)) return [];
  const calls: Array<{ id: string } & ToolCallDisplay> = [];
  for (const block of content) {
    const obj = asRecord(block);
    const type = obj ? stringValue(obj.type) : undefined;
    if (!obj || (type !== 'toolCall' && type !== 'tool_use' && type !== 'tool_call')) continue;
    const id =
      stringValue(obj.id) ??
      stringValue(obj.toolCallId) ??
      stringValue(obj.tool_call_id) ??
      stringValue(obj.tool_call_id$);
    if (!id) continue;
    const name = toolNameFromBlock(obj);
    const args = toolArgsFromBlock(obj);
    const files = filesFromArgs(args);
    calls.push({
      id,
      name,
      files,
      kind: toolKind(name, files),
      preview: formatToolCallPreview(name, args),
      status: stringValue(obj.status) === 'running' ? 'running' : undefined,
    });
  }
  return calls;
}

function rowToolCallId(row: unknown): string | undefined {
  const record = asRecord(row);
  return (
    stringValue(record?.toolCallId) ??
    stringValue(record?.tool_call_id) ??
    stringValue(record?.tool_call_id$)
  );
}

function rowCreatedAt(row: TranscriptStoredRow): string | undefined {
  const record = asRecord(row);
  return stringValue(record?.createdAt) ?? stringValue(record?.timestamp);
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function messageLabel(row: AgentMessage): string {
  const role = stringValue((row as { role?: unknown }).role) ?? 'message';
  if (role === 'tool' || role === 'toolResult') {
    return `tool:${stringValue((row as { toolName?: unknown }).toolName) ?? 'result'}`;
  }
  return role;
}

function rowPreview(row: TranscriptStoredRow): string {
  if (isTranscriptContextEntry(row)) {
    return truncateText(row.text ?? JSON.stringify(row.data ?? {}));
  }
  if (isTranscriptLabelEntry(row)) {
    return truncateText(row.label ? `label: ${row.label}` : 'label cleared');
  }
  if (isTranscriptMetadataEntry(row)) {
    if (row.type === 'model_change') {
      return truncateText([row.provider, row.modelId].filter(Boolean).join('/') || 'model changed');
    }
    if (row.type === 'thinking_level_change') {
      return truncateText(row.thinkingLevel ? `thinking: ${row.thinkingLevel}` : 'thinking changed');
    }
    return truncateText(row.name ? `title: ${row.name}` : 'title cleared');
  }
  if (isTranscriptBashExecutionEntry(row)) {
    return truncateText(row.command ?? 'bash');
  }
  if (isTranscriptCustomMessageEntry(row)) {
    const record = asRecord(row);
    const customType = stringValue(record?.customType) ?? 'custom';
    const preview = contentPreview(record?.content);
    return truncateText(preview ? `${customType}: ${preview}` : customType);
  }
  if (isTranscriptSummaryMessageEntry(row)) {
    if (row.role === 'branchSummary') {
      return truncateText(row.summary ?? 'branch summary');
    }
    return truncateText(row.summary ?? 'compaction checkpoint');
  }
  const record = asRecord(row);
  if (record?.type === 'compaction') {
    return truncateText(stringValue(record.summary) ?? 'compaction checkpoint');
  }
  const content = contentText(record?.content);
  const preview = truncateText(record?.role === 'user'
    ? stripRuntimeContextFromUserMessage(content)
    : content);
  if (record?.role === 'assistant' && !preview) {
    if (record.stopReason === 'aborted') {
      return '(aborted)';
    }
    const errorMessage = stringValue(record.errorMessage);
    if (errorMessage) {
      return truncateText(errorMessage, 80);
    }
  }
  return preview;
}

function rowContentText(row: TranscriptStoredRow): string | undefined {
  if (isTranscriptContextEntry(row)) {
    return row.text;
  }
  if (isTranscriptLabelEntry(row)) {
    return row.label;
  }
  if (isTranscriptMetadataEntry(row)) {
    if (row.type === 'model_change') {
      return [row.provider, row.modelId].filter(Boolean).join('/') || undefined;
    }
    if (row.type === 'thinking_level_change') {
      return row.thinkingLevel;
    }
    return row.name;
  }
  if (isTranscriptBashExecutionEntry(row)) {
    return row.command;
  }
  if (isTranscriptCustomMessageEntry(row)) {
    const record = asRecord(row);
    return contentText(record?.content).trim() || stringValue(record?.customType);
  }
  if (isTranscriptSummaryMessageEntry(row)) {
    return row.summary;
  }
  const record = asRecord(row);
  if (record?.type === 'compaction') {
    return stringValue(record.summary);
  }
  const rawText = contentText(record?.content);
  const text = (record?.role === 'user'
    ? stripRuntimeContextFromUserMessage(rawText)
    : rawText).trim();
  return text ? text : undefined;
}

function roleForTimeline(role: string | undefined): SessionTimelineItem['role'] | undefined {
  if (role === 'user' || role === 'assistant' || role === 'system') return role;
  return undefined;
}

function inferStatus(row: TranscriptStoredRow, toolCall?: ToolCallDisplay): SessionTimelineItem['status'] | undefined {
  const record = asRecord(row);
  const rawStatus = stringValue(record?.status);
  if (rawStatus === 'running' || rawStatus === 'done' || rawStatus === 'error') return rawStatus;
  if (toolCall?.status) return toolCall.status;
  if (record?.isError === true || stringValue(record?.errorMessage)) return 'error';
  if (isTranscriptBashExecutionEntry(row) && typeof row.exitCode === 'number') {
    return row.exitCode === 0 ? 'done' : 'error';
  }
  if (record?.role === 'tool' || record?.role === 'toolResult') return 'done';
  return undefined;
}

function titleForEntry(params: {
  kind: SessionTimelineItemKind;
  label: string;
  role?: string;
  turn: number;
  preview?: string;
  toolName?: string;
}): string {
  if (params.kind === 'turn') {
    if (params.role === 'user') return `Turn ${params.turn}`;
    return params.role ?? 'message';
  }
  if (params.kind === 'file' || params.kind === 'command' || params.kind === 'tool') {
    return params.toolName ?? (params.label.replace(/^tool:/, '') || params.kind);
  }
  if (params.kind === 'branch') return 'branch summary';
  return params.label;
}

function isDisplayMessageRow(row: TranscriptStoredRow): boolean {
  if (isTranscriptContextEntry(row)) return false;
  if (isTranscriptLabelEntry(row)) return false;
  if (isTranscriptMetadataEntry(row)) return false;
  const record = asRecord(row);
  if (record?.type === 'compaction') return false;
  if (isTranscriptSummaryMessageEntry(row)) return false;
  if (record?.role === 'tool' || record?.role === 'toolResult' || record?.role === 'system') return false;
  if (isTranscriptBashExecutionEntry(row) || isTranscriptCustomMessageEntry(row)) return true;
  return Boolean(stringValue(record?.role));
}

function displayIndexForRow(params: {
  row: TranscriptStoredRow;
  role?: string;
  nextDisplayIndex: number;
  lastDisplayRole?: 'assistant' | 'other';
}): { rowDisplayIndex?: number; nextDisplayIndex: number; lastDisplayRole?: 'assistant' | 'other' } {
  const { row, role, nextDisplayIndex, lastDisplayRole } = params;
  if (!isDisplayMessageRow(row)) {
    return { nextDisplayIndex, lastDisplayRole };
  }
  if (role === 'assistant') {
    if (lastDisplayRole === 'assistant') {
      return {
        rowDisplayIndex: Math.max(0, nextDisplayIndex - 1),
        nextDisplayIndex,
        lastDisplayRole,
      };
    }
    return {
      rowDisplayIndex: nextDisplayIndex,
      nextDisplayIndex: nextDisplayIndex + 1,
      lastDisplayRole: 'assistant',
    };
  }
  return {
    rowDisplayIndex: nextDisplayIndex,
    nextDisplayIndex: nextDisplayIndex + 1,
    lastDisplayRole: 'other',
  };
}

function classifyRow(params: {
  row: TranscriptStoredRow;
  label: string;
  role?: string;
  toolCall?: ToolCallDisplay;
}): { kind: SessionTimelineItemKind; files: string[]; toolName?: string } {
  const { row, label, role, toolCall } = params;
  const record = asRecord(row);
  if (isTranscriptContextEntry(row) || isTranscriptLabelEntry(row) || isTranscriptMetadataEntry(row)) {
    return { kind: 'context', files: [] };
  }
  if (isTranscriptBashExecutionEntry(row)) {
    return { kind: 'command', files: [] };
  }
  if (isTranscriptSummaryMessageEntry(row)) {
    return { kind: row.role === 'branchSummary' ? 'branch' : 'compaction', files: [] };
  }
  if (record?.type === 'compaction') {
    return { kind: 'compaction', files: [] };
  }
  if (role === 'tool' || role === 'toolResult' || label.startsWith('tool:')) {
    const toolName = toolCall?.name ?? (label.replace(/^tool:/, '') || stringValue(record?.toolName));
    const files = toolCall?.files ?? filesFromArgs(record ?? {});
    return { kind: toolKind(toolName ?? 'tool', files), files, toolName };
  }
  return { kind: 'turn', files: [] };
}

export function buildTranscriptOutline(rows: TranscriptStoredRow[]): TranscriptOutlineEntry[] {
  const entries: TranscriptOutlineEntry[] = [];
  const byOriginalId = new Map<string, TranscriptOutlineEntry>();
  const toolCallsById = new Map<string, ToolCallDisplay>();
  const labelChanges: Array<{ targetId: string; label?: string; timestamp?: string }> = [];
  let currentTurnId: string | undefined;
  let turn = 0;
  let nextDisplayIndex = 0;
  let lastDisplayRole: 'assistant' | 'other' | undefined;
  let lastAssistantDisplayIndex: number | undefined;

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const id = `row-${rowNumber}`;
    const record = asRecord(row);
    let parentId: string | undefined;
    let depth = 0;
    let label = 'entry';
    let role: string | undefined;
    let toolCallPreview: string | undefined;
    let toolCall: ToolCallDisplay | undefined;

    if (isTranscriptContextEntry(row)) {
      label = 'context';
      parentId = currentTurnId;
      depth = currentTurnId ? 1 : 0;
    } else if ((asRecord(row)?.type) === 'compaction') {
      label = 'compaction';
      parentId = currentTurnId;
      depth = currentTurnId ? 1 : 0;
    } else if (isTranscriptLabelEntry(row)) {
      label = row.label ? `label:${row.label}` : 'label:cleared';
      parentId = currentTurnId;
      depth = currentTurnId ? 1 : 0;
      if (row.targetId) {
        labelChanges.push({
          targetId: row.targetId,
          label: row.label,
          timestamp: typeof row.timestamp === 'string' ? row.timestamp : undefined,
        });
      }
    } else if (isTranscriptMetadataEntry(row)) {
      label = row.type;
      parentId = currentTurnId;
      depth = currentTurnId ? 1 : 0;
    } else if (isTranscriptBashExecutionEntry(row)) {
      label = 'bashExecution';
      parentId = currentTurnId;
      depth = currentTurnId ? 1 : 0;
    } else if (isTranscriptCustomMessageEntry(row)) {
      label = `custom:${stringValue(record?.customType) ?? 'message'}`;
      parentId = currentTurnId;
      depth = currentTurnId ? 1 : 0;
    } else if (isTranscriptSummaryMessageEntry(row)) {
      label = row.role === 'branchSummary' ? 'branch_summary' : 'compaction';
      parentId = currentTurnId;
      depth = currentTurnId ? 1 : 0;
    } else {
      const message = row as AgentMessage;
      role = stringValue((message as { role?: unknown }).role);
      label = messageLabel(message);
      if (role === 'tool' || role === 'toolResult') {
        const toolCallId = rowToolCallId(row);
        toolCall = toolCallId ? toolCallsById.get(toolCallId) : undefined;
        if (toolCall) {
          label = `tool:${toolCall.name}`;
          toolCallPreview = toolCall.preview;
        }
      }
      if (role === 'user' || !currentTurnId) {
        turn += 1;
        currentTurnId = id;
        depth = 0;
      } else {
        parentId = currentTurnId;
        depth = 1;
      }
    }

    const display = displayIndexForRow({
      row,
      role,
      nextDisplayIndex,
      lastDisplayRole,
    });
    const rowDisplayIndex = display.rowDisplayIndex;
    nextDisplayIndex = display.nextDisplayIndex;
    lastDisplayRole = display.lastDisplayRole;
    if (role === 'assistant' && rowDisplayIndex !== undefined) {
      lastAssistantDisplayIndex = rowDisplayIndex;
    }
    const { kind, files, toolName } = classifyRow({ row, label, role, toolCall });
    const preview = rowPreview(row);
    const createdAt = rowCreatedAt(row);
    const content = rowContentText(row);
    const status = inferStatus(row, toolCall);
    const timestamp = parseTimestamp(createdAt ?? record?.timestamp);
    const entryDisplayIndex =
      rowDisplayIndex ??
      (kind === 'tool' || kind === 'file' || kind === 'command'
        ? lastAssistantDisplayIndex
        : undefined);
    const meta =
      toolName || files.length > 0
        ? {
            ...(toolName ? { toolName } : {}),
            ...(files.length > 0 ? { files } : {}),
          }
        : undefined;

    const entry: TranscriptOutlineEntry = {
      id,
      depth,
      label,
      turn,
      preview,
      kind,
      title: titleForEntry({ kind, label, role, turn, preview, toolName }),
      rowNumber,
      ...(timestamp !== undefined ? { timestamp } : {}),
      ...(entryDisplayIndex !== undefined ? { displayIndex: entryDisplayIndex } : {}),
      ...(content ? { contentText: content } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(meta ? { meta } : {}),
      ...(status ? { status } : {}),
    };
    if (parentId) entry.parentId = parentId;
    if (role) entry.role = role;
    if (toolCallPreview) entry.toolCallPreview = toolCallPreview;
    entries.push(entry);

    byOriginalId.set(id, entry);
    const originalId = stringValue(record?.id);
    if (originalId) {
      byOriginalId.set(originalId, entry);
    }

    for (const nextToolCall of collectToolCallDisplays(record?.content)) {
      toolCallsById.set(nextToolCall.id, {
        name: nextToolCall.name,
        preview: nextToolCall.preview,
        files: nextToolCall.files,
        kind: nextToolCall.kind,
        status: nextToolCall.status,
      });
    }
  });

  for (const change of labelChanges) {
    const target = byOriginalId.get(change.targetId);
    if (!target) continue;
    if (change.label?.trim()) {
      target.userLabel = change.label.trim();
      target.labelTimestamp = change.timestamp;
    } else {
      delete target.userLabel;
      delete target.labelTimestamp;
    }
  }

  markCurrentTranscriptPath(entries);

  return entries;
}

function markCurrentTranscriptPath(entries: TranscriptOutlineEntry[]): void {
  const currentLeaf = [...entries].reverse().find(isCurrentLeafCandidate) ?? entries.at(-1);
  if (!currentLeaf) return;

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  currentLeaf.isCurrentLeaf = true;
  let currentId: string | undefined = currentLeaf.id;
  while (currentId) {
    const entry = byId.get(currentId);
    if (!entry) break;
    entry.isOnActivePath = true;
    currentId = entry.parentId;
  }
}

function isCurrentLeafCandidate(entry: TranscriptOutlineEntry): boolean {
  if (entry.label === 'context') return false;
  if (entry.label === 'model_change') return false;
  if (entry.label === 'thinking_level_change') return false;
  if (entry.label === 'session_info') return false;
  if (entry.label.startsWith('label:')) return false;
  return true;
}

export function buildSessionTimeline(rows: TranscriptStoredRow[]): SessionTimelineItem[] {
  return buildTranscriptOutline(rows).map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    ...(roleForTimeline(entry.role) ? { role: roleForTimeline(entry.role) } : {}),
    title: entry.title,
    ...(entry.preview ? { preview: entry.preview } : {}),
    ...(entry.timestamp !== undefined ? { timestamp: entry.timestamp } : {}),
    depth: entry.depth,
    turn: entry.turn,
    ...(entry.displayIndex !== undefined ? { displayIndex: entry.displayIndex } : {}),
    rowNumber: entry.rowNumber,
    ...(entry.status ? { status: entry.status } : {}),
    ...(entry.meta ? { meta: entry.meta } : {}),
  }));
}
