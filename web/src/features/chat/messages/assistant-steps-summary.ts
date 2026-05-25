// Builders for the collapsed "steps round" header — the one-line summary shown
// when a tool round finishes, plus the small helpers (`filterVisibleSteps`,
// `viewStepsLabel`) shared between the collapsed and expanded states.

import type { ThinkingContent, ToolUseContent } from '@/features/chat/messages/messages.types';
import {
  extractCommandPreview,
  extractPathPreview,
  extractSearchQuery,
  extractUrlPreview,
  getKeyDetailLine,
} from '@/features/chat/messages/tool-input-preview';
import {
  getFriendlyToolTitle,
  toolNameKey,
  type FriendlyToolTitleLabels,
} from '@/features/chat/messages/tool-friendly-title';
import { isWebSearchToolName } from '@/features/chat/tool-results/web-search-tool-result-links';
import type { StoredLanguage } from '@/lib/storage';

export type FirstToolHeaderLabels = FriendlyToolTitleLabels;

const FIRST_TOOL_DETAIL_MAX = 120;
const COMPLETE_HEADER_LINE_MAX = 240;

export function filterVisibleSteps(
  blocks: Array<ThinkingContent | ToolUseContent>,
): Array<ThinkingContent | ToolUseContent> {
  return blocks.filter(
    (b) =>
      b.type !== 'thinking' ||
      Boolean(b.text?.trim()) ||
      Boolean(b.streaming),
  );
}

export function viewStepsLabel(
  count: number,
  m: { viewSteps_one: string; viewSteps_other: string },
): string {
  const key = count === 1 ? m.viewSteps_one : m.viewSteps_other;
  return key.replace(/\{\{count\}\}/g, String(count));
}

function previewDetailForFirstToolHeader(block: ToolUseContent): string {
  const input = block.input;
  const n = toolNameKey(block.name);
  if (isWebSearchToolName(block.name)) {
    const q = extractSearchQuery(input);
    if (q.trim()) return q.trim();
  }
  if (n === 'shell') {
    const c = extractCommandPreview(input);
    if (c.trim()) return c.trim();
  }
  if (n === 'read_file' || n.includes('read_file')) {
    const p = extractPathPreview(input);
    if (p.trim()) return p.trim();
  }
  if (n === 'web_fetch' || n === 'open_url') {
    const u = extractUrlPreview(input);
    if (u.trim()) return u.trim();
  }
  return getKeyDetailLine(input).trim();
}

/** One-line "what happened" when a tool round finishes (first tool + best input preview). */
export function buildStepsRoundCompleteSummary(
  visibleBlocks: Array<ThinkingContent | ToolUseContent>,
  labels: FirstToolHeaderLabels,
  language: StoredLanguage,
  /** When there is no tool step (e.g. only thinking), show this (e.g. "View N steps"). */
  noToolFallback: string,
): string {
  const firstTool = visibleBlocks.find((b): b is ToolUseContent => b.type === 'tool_use');
  if (!firstTool) {
    return noToolFallback;
  }

  const title = getFriendlyToolTitle(firstTool.name, labels);

  let detail = previewDetailForFirstToolHeader(firstTool);
  if (!detail) {
    return title;
  }
  if (detail.length > FIRST_TOOL_DETAIL_MAX) {
    detail = `${detail.slice(0, FIRST_TOOL_DETAIL_MAX)}…`;
  }

  const colon = language === 'zh' ? '：' : ': ';
  let line = `${title}${colon}${detail}`;
  if (line.length > COMPLETE_HEADER_LINE_MAX) {
    line = `${line.slice(0, COMPLETE_HEADER_LINE_MAX)}…`;
  }
  return line;
}
