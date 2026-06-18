import type { AgentMessage } from '@earendil-works/pi-agent-core';

import {
  isTranscriptBashExecutionEntry,
  isTranscriptContextEntry,
  isTranscriptCustomMessageEntry,
  isTranscriptLabelEntry,
  isTranscriptMetadataEntry,
  isTranscriptSummaryMessageEntry,
  type TranscriptStoredRow,
} from '../session/session-context-for-llm.js';
import type { TuiTranscriptTreeEntry } from './tui-backend.js';
import type { TreeFilterMode } from './tui-settings.js';

const TRANSCRIPT_ROW_ID_RE = /^row-(\d+)$/;

export function transcriptTreeEntryIdToRowNumber(entryId: string): number | null {
  const match = TRANSCRIPT_ROW_ID_RE.exec(entryId.trim());
  if (!match) return null;
  const row = Number.parseInt(match[1], 10);
  return Number.isFinite(row) && row > 0 ? row : null;
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
    } else if (type === 'toolCall') {
      parts.push(formatToolCallPreview(
        stringValue(obj.name) ?? stringValue(obj.toolName) ?? 'tool',
        asRecord(obj.arguments) ?? asRecord(obj.args) ?? {},
      ));
    } else if (type === 'image' || type === 'image_url') {
      parts.push('[image]');
    } else if (type) {
      parts.push(`[${type}]`);
    }
  }
  return parts.filter(Boolean).join(' ');
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

interface ToolCallDisplay {
  name: string;
  preview: string;
}

function collectToolCallDisplays(content: unknown): Array<{ id: string } & ToolCallDisplay> {
  if (!Array.isArray(content)) return [];
  const calls: Array<{ id: string } & ToolCallDisplay> = [];
  for (const block of content) {
    const obj = asRecord(block);
    if (!obj || stringValue(obj.type) !== 'toolCall') continue;
    const id =
      stringValue(obj.id) ??
      stringValue(obj.toolCallId) ??
      stringValue(obj.tool_call_id) ??
      stringValue(obj.tool_call_id$);
    if (!id) continue;
    const name = stringValue(obj.name) ?? stringValue(obj.toolName) ?? 'tool';
    calls.push({
      id,
      name,
      preview: formatToolCallPreview(name, asRecord(obj.arguments) ?? asRecord(obj.args) ?? {}),
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
  const preview = contentPreview(record?.content);
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
  const text = contentText(record?.content).trim();
  return text ? text : undefined;
}

export function buildTuiTranscriptTree(rows: TranscriptStoredRow[]): TuiTranscriptTreeEntry[] {
  const entries: TuiTranscriptTreeEntry[] = [];
  const byOriginalId = new Map<string, TuiTranscriptTreeEntry>();
  const toolCallsById = new Map<string, ToolCallDisplay>();
  const labelChanges: Array<{ targetId: string; label?: string; timestamp?: string }> = [];
  let currentTurnId: string | undefined;
  let turn = 0;

  rows.forEach((row, index) => {
    const id = `row-${index + 1}`;
    const record = asRecord(row);
    let parentId: string | undefined;
    let depth = 0;
    let label = 'entry';
    let role: string | undefined;
    let toolCallPreview: string | undefined;

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
        const toolCall = toolCallId ? toolCallsById.get(toolCallId) : undefined;
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

    const entry: TuiTranscriptTreeEntry = {
      id,
      depth,
      label,
      turn,
      preview: rowPreview(row),
      contentText: rowContentText(row),
      createdAt: rowCreatedAt(row),
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

    for (const toolCall of collectToolCallDisplays(record?.content)) {
      toolCallsById.set(toolCall.id, { name: toolCall.name, preview: toolCall.preview });
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

function markCurrentTranscriptPath(entries: TuiTranscriptTreeEntry[]): void {
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

function isCurrentLeafCandidate(entry: TuiTranscriptTreeEntry): boolean {
  if (entry.label === 'context') return false;
  if (entry.label === 'model_change') return false;
  if (entry.label === 'thinking_level_change') return false;
  if (entry.label === 'session_info') return false;
  if (entry.label.startsWith('label:')) return false;
  return true;
}

export function filterTuiTranscriptTreeEntries(
  entries: TuiTranscriptTreeEntry[],
  mode: TreeFilterMode,
): TuiTranscriptTreeEntry[] {
  if (mode === 'all') return entries;
  return entries.filter((entry) => {
    if (!entry.isCurrentLeaf && isEmptyAssistantTreeEntry(entry)) {
      return false;
    }
    if (mode === 'user-only') {
      return entry.role === 'user';
    }
    if (mode === 'labeled-only') {
      return Boolean(entry.userLabel);
    }
    const isTool = entry.role === 'tool' || entry.role === 'toolResult' || entry.label.startsWith('tool:');
    const isBookkeeping =
      entry.label === 'context' ||
      entry.label === 'model_change' ||
      entry.label === 'thinking_level_change' ||
      entry.label === 'session_info' ||
      entry.label.startsWith('custom:') ||
      entry.label.startsWith('label:');
    if (mode === 'no-tools') {
      return !isTool && !isBookkeeping;
    }
    return !isBookkeeping;
  });
}

function isEmptyAssistantTreeEntry(entry: TuiTranscriptTreeEntry): boolean {
  if (entry.role !== 'assistant') return false;
  const preview = entry.preview?.trim();
  if (!preview) return true;
  return /^(?:\[[^\]]+\]\s*)+$/.test(preview);
}

export function formatTuiTranscriptTreeEntryDisplayText(entry: TuiTranscriptTreeEntry): string {
  const preview = entry.preview?.trim();
  const toolCallPreview = entry.toolCallPreview?.trim();
  const role = entry.role?.trim() || entry.label;
  if (!preview) {
    if (role === 'assistant') return 'assistant: (no content)';
    if (role === 'tool' || role === 'toolResult' || entry.label.startsWith('tool:')) {
      return `[${formatTuiTranscriptToolDisplayName(entry.label)}]`;
    }
    return entry.label;
  }
  if (role === 'user' || role === 'assistant') {
    return `${role}: ${preview}`;
  }
  if (role === 'bashExecution' || entry.label === 'bashExecution') {
    return `[bash]: ${preview}`;
  }
  if (role === 'tool' || role === 'toolResult' || entry.label.startsWith('tool:')) {
    if (toolCallPreview) return toolCallPreview;
    return `[${formatTuiTranscriptToolDisplayName(entry.label)}]`;
  }
  if (entry.label === 'model_change') {
    const model = preview.includes('/') ? (preview.split('/').pop() ?? preview) : preview;
    return `[model: ${model}]`;
  }
  if (entry.label === 'thinking_level_change') {
    return `[${preview}]`;
  }
  if (entry.label === 'session_info') {
    return `[${preview}]`;
  }
  if (entry.label.startsWith('label:')) {
    return `[${preview}]`;
  }
  if (entry.label === 'compaction') {
    return `[compaction: ${preview}]`;
  }
  if (entry.label === 'branch_summary') {
    return `[branch summary]: ${preview}`;
  }
  if (entry.label.startsWith('custom:')) {
    return `[${entry.label}]${preview ? `: ${preview}` : ''}`;
  }
  return `${entry.label}: ${preview}`;
}

function formatTuiTranscriptToolDisplayName(label: string): string {
  return label.startsWith('tool:') ? label.slice('tool:'.length) || 'tool' : label;
}
