import type { TranscriptStoredRow } from '../session/session-context-for-llm.js';
import { buildTranscriptOutline } from '../session/transcript-outline.js';
import type { TuiTranscriptTreeEntry } from './tui-backend.js';
import type { TreeFilterMode } from './tui-settings.js';

const TRANSCRIPT_ROW_ID_RE = /^row-(\d+)$/;

export function transcriptTreeEntryIdToRowNumber(entryId: string): number | null {
  const match = TRANSCRIPT_ROW_ID_RE.exec(entryId.trim());
  if (!match) return null;
  const row = Number.parseInt(match[1], 10);
  return Number.isFinite(row) && row > 0 ? row : null;
}

export function buildTuiTranscriptTree(rows: TranscriptStoredRow[]): TuiTranscriptTreeEntry[] {
  return buildTranscriptOutline(rows).map((entry) => ({
    id: entry.id,
    ...(entry.parentId ? { parentId: entry.parentId } : {}),
    depth: entry.depth,
    label: entry.label,
    ...(entry.role ? { role: entry.role } : {}),
    ...(entry.userLabel ? { userLabel: entry.userLabel } : {}),
    ...(entry.labelTimestamp ? { labelTimestamp: entry.labelTimestamp } : {}),
    turn: entry.turn,
    ...(entry.preview ? { preview: entry.preview } : {}),
    ...(entry.contentText ? { contentText: entry.contentText } : {}),
    ...(entry.toolCallPreview ? { toolCallPreview: entry.toolCallPreview } : {}),
    ...(entry.createdAt ? { createdAt: entry.createdAt } : {}),
    ...(entry.isOnActivePath ? { isOnActivePath: entry.isOnActivePath } : {}),
    ...(entry.isCurrentLeaf ? { isCurrentLeaf: entry.isCurrentLeaf } : {}),
  }));
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
