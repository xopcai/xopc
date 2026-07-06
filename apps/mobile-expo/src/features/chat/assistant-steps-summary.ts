// Builders for the collapsed "steps round" header — the one-line summary shown
// when a tool round finishes, plus helpers shared between collapsed and expanded states.

import type { ThinkingContent, ToolUseContent } from './messages.types';
import {
  extractCommandPreview,
  extractPathPreview,
  extractSearchQuery,
  extractUrlPreview,
  getKeyDetailLine,
} from './tool-input-preview';
import {
  getFriendlyToolTitle,
  toolNameKey,
  type FriendlyToolTitleLabels,
} from './tool-friendly-title';
import { isWebSearchToolName } from './web-search-tool-result-links';
import type { Language } from '../../stores/preferences-store';

export type FirstToolHeaderLabels = FriendlyToolTitleLabels;

const FIRST_TOOL_DETAIL_MAX = 72;
const COMPLETE_HEADER_LINE_MAX = 160;

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

function shortDetail(detail: string, maxLength = FIRST_TOOL_DETAIL_MAX): string {
  const trimmed = detail.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}…`;
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

function formatResultCount(count: number, language: Language): string {
  if (language === 'zh') return `${count} 条结果`;
  return `${count} result${count === 1 ? '' : 's'}`;
}

function parseToolResultCount(block: ToolUseContent): number | null {
  if (!isWebSearchToolName(block.name) || block.result == null) return null;

  let parsed: unknown;
  try {
    parsed = typeof block.result === 'string' ? JSON.parse(block.result) : block.result;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const details = record.details;
  if (details && typeof details === 'object') {
    const results = (details as Record<string, unknown>).results;
    if (Array.isArray(results)) return results.length;
  }
  if (Array.isArray(record.results)) return record.results.length;
  return null;
}

function uniqueToolTitles(
  visibleBlocks: Array<ThinkingContent | ToolUseContent>,
  labels: FirstToolHeaderLabels,
): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  for (const block of visibleBlocks) {
    if (block.type !== 'tool_use') continue;
    const title = getFriendlyToolTitle(block.name, labels);
    if (seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
  }
  return titles;
}

function joinToolTitles(titles: string[], language: Language): string {
  const visibleTitles = titles.slice(0, 2);
  const separator = language === 'zh' ? '、' : ', ';
  const joined = visibleTitles.join(separator);
  if (titles.length <= 2) return joined;
  return language === 'zh' ? `${joined}等` : `${joined}, more`;
}

export function buildStepsRoundActiveSummary(
  visibleBlocks: Array<ThinkingContent | ToolUseContent>,
  labels: FirstToolHeaderLabels,
  language: Language,
  noToolFallback: string,
): string {
  const activeTool = visibleBlocks.find(
    (block): block is ToolUseContent => block.type === 'tool_use' && block.status === 'running',
  );
  if (!activeTool) return noToolFallback;

  const title = getFriendlyToolTitle(activeTool.name, labels);
  const detail = shortDetail(previewDetailForFirstToolHeader(activeTool));
  const prefix = language === 'zh' ? '正在' : 'Running';
  const main = language === 'zh' ? `${prefix}${title}` : `${prefix} ${title.toLowerCase()}`;
  return detail ? `${main} · ${detail}` : `${main}…`;
}

/** One-line "what happened" when a tool round finishes. */
export function buildStepsRoundCompleteSummary(
  visibleBlocks: Array<ThinkingContent | ToolUseContent>,
  labels: FirstToolHeaderLabels,
  language: Language,
  /** When there is no tool step (e.g. only thinking), show this (e.g. "View N steps"). */
  noToolFallback: string,
): string {
  const firstTool = visibleBlocks.find((b): b is ToolUseContent => b.type === 'tool_use');
  if (!firstTool) {
    return noToolFallback;
  }

  const titles = uniqueToolTitles(visibleBlocks, labels);
  const titleSummary = joinToolTitles(titles, language);
  const resultCount = parseToolResultCount(firstTool);
  const detail = shortDetail(previewDetailForFirstToolHeader(firstTool));
  const parts = [titleSummary];

  if (resultCount != null) {
    parts.push(formatResultCount(resultCount, language));
  }
  if (detail) {
    parts.push(detail);
  }

  let line = parts.join(' · ');
  if (line.length > COMPLETE_HEADER_LINE_MAX) {
    line = `${line.slice(0, COMPLETE_HEADER_LINE_MAX)}…`;
  }
  return line;
}
