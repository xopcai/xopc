// Tool-action clustering: classify each tool_use into an ActionKind, count
// per kind, and turn the result into a single human-readable header line for
// the collapsed steps drawer (streaming or completed).
//
// Pure module — no React, no i18n loader. Callers pass label bags so this stays
// trivially testable in both languages.

import type { ThinkingContent, ToolUseContent } from '@/features/chat/messages/messages.types';
import { toolNameKey } from '@/features/chat/messages/tool-friendly-title';
import {
  extractCommandPreview,
  extractPathPreview,
  extractSearchQuery,
  extractUrlPreview,
  getKeyDetailLine,
} from '@/features/chat/messages/tool-input-preview';
import { isWebSearchToolName } from '@/features/chat/tool-results/web-search-tool-result-parser';
import type { StoredLanguage } from '@/lib/storage';

export type ActionKind =
  | 'search'
  | 'readFile'
  | 'editFile'
  | 'writeFile'
  | 'runCommand'
  | 'listDir'
  | 'openUrl'
  | 'fetchUrl'
  | 'other';

export type ClusterCount = { total: number; running: number };

export type ClusterMap = Map<ActionKind, ClusterCount>;

export type StepsClusterDoneLabels = Record<
  | 'search_one'
  | 'search_other'
  | 'readFile_one'
  | 'readFile_other'
  | 'editFile_one'
  | 'editFile_other'
  | 'writeFile_one'
  | 'writeFile_other'
  | 'runCommand_one'
  | 'runCommand_other'
  | 'listDir_one'
  | 'listDir_other'
  | 'openUrl_one'
  | 'openUrl_other'
  | 'fetchUrl_one'
  | 'fetchUrl_other'
  | 'other_one'
  | 'other_other',
  string
>;

export type StepsClusterIngLabels = Record<
  | 'thinking'
  | 'search'
  | 'readFile'
  | 'editFile'
  | 'writeFile'
  | 'runCommand'
  | 'listDir'
  | 'openUrl'
  | 'fetchUrl'
  | 'other'
  | 'mixed',
  string
>;

export type StepsClusterJoinLabels = {
  join: string;
  joinFinal: string;
  moreSuffix: string;
};

const FIRST_TOOL_DETAIL_MAX = 120;
const HEADER_LINE_MAX = 240;
const MAX_CLUSTERS_IN_LINE = 3;

/** Ordered for stable output when summarizing multiple clusters. */
const KIND_ORDER: ActionKind[] = [
  'readFile',
  'editFile',
  'writeFile',
  'runCommand',
  'search',
  'fetchUrl',
  'openUrl',
  'listDir',
  'other',
];

export function classifyTool(name: string): ActionKind {
  const n = toolNameKey(name);
  if (n === 'exec_command') return 'runCommand';
  if (n === 'list_dir' || n === 'ls') return 'listDir';
  if (n === 'write_file') return 'writeFile';
  if (n === 'apply_patch') return 'editFile';
  if (n === 'web_fetch') return 'fetchUrl';
  if (n === 'open_url') return 'openUrl';
  if (isWebSearchToolName(name) || n.includes('search')) return 'search';
  if (n === 'read_file' || n.includes('read_file') || n.includes('file_read')) return 'readFile';
  return 'other';
}

export function clusterToolUses(
  blocks: ReadonlyArray<ThinkingContent | ToolUseContent>,
): ClusterMap {
  const out: ClusterMap = new Map();
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue;
    const kind = classifyTool(b.name);
    const cur = out.get(kind) ?? { total: 0, running: 0 };
    cur.total += 1;
    if (b.status === 'running') cur.running += 1;
    out.set(kind, cur);
  }
  return out;
}

function pluralLabel(
  kind: ActionKind,
  count: number,
  labels: StepsClusterDoneLabels,
): string {
  const key: keyof StepsClusterDoneLabels = count === 1 ? `${kind}_one` : `${kind}_other`;
  return labels[key].replace(/\{\{count\}\}/g, String(count));
}

function ingLabel(kind: ActionKind, labels: StepsClusterIngLabels): string {
  switch (kind) {
    case 'search':
      return labels.search;
    case 'readFile':
      return labels.readFile;
    case 'editFile':
      return labels.editFile;
    case 'writeFile':
      return labels.writeFile;
    case 'runCommand':
      return labels.runCommand;
    case 'listDir':
      return labels.listDir;
    case 'openUrl':
      return labels.openUrl;
    case 'fetchUrl':
      return labels.fetchUrl;
    case 'other':
      return labels.other;
  }
}

function orderKinds(map: ClusterMap): ActionKind[] {
  const present: ActionKind[] = [];
  for (const k of KIND_ORDER) {
    if (map.has(k)) present.push(k);
  }
  return present;
}

function joinPhrases(parts: string[], join: StepsClusterJoinLabels): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]}${join.joinFinal}${parts[1]}`;
  const head = parts.slice(0, -1).join(join.join);
  return `${head}${join.joinFinal}${parts[parts.length - 1]}`;
}

function truncate(line: string, max: number): string {
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/**
 * "Single-tool single-call" preview: keep the existing high-density format
 * (e.g. "Searched web: my query"). Returns null if we shouldn't use this path.
 */
function singleToolDetailLine(
  block: ToolUseContent,
  kind: ActionKind,
  labels: StepsClusterDoneLabels,
  language: StoredLanguage,
): string | null {
  const input = block.input;
  let detail = '';
  if (kind === 'search') {
    detail = extractSearchQuery(input).trim();
  } else if (kind === 'runCommand') {
    detail = extractCommandPreview(input).trim();
  } else if (kind === 'readFile' || kind === 'editFile' || kind === 'writeFile') {
    detail = extractPathPreview(input).trim();
  } else if (kind === 'fetchUrl' || kind === 'openUrl') {
    detail = extractUrlPreview(input).trim();
  } else {
    detail = getKeyDetailLine(input).trim();
  }
  if (!detail) return null;
  const title = pluralLabel(kind, 1, labels);
  const colon = language === 'zh' ? '：' : ': ';
  return truncate(`${title}${colon}${truncate(detail, FIRST_TOOL_DETAIL_MAX)}`, HEADER_LINE_MAX);
}

/**
 * Completed-round header text. Returns `null` when there are no tool uses
 * (caller should fall back to a thinking-only label or "View N steps").
 */
export function summarizeClustersCompleted(
  blocks: ReadonlyArray<ThinkingContent | ToolUseContent>,
  doneLabels: StepsClusterDoneLabels,
  joinLabels: StepsClusterJoinLabels,
  language: StoredLanguage,
): string | null {
  const map = clusterToolUses(blocks);
  if (map.size === 0) return null;

  // Single-tool, single-call: preserve the rich "title: detail" preview that
  // power users rely on (e.g. the search query, the file path).
  const onlyKind = map.size === 1 ? [...map.keys()][0] : null;
  if (onlyKind && map.get(onlyKind)!.total === 1) {
    const firstTool = blocks.find(
      (b): b is ToolUseContent => b.type === 'tool_use' && classifyTool(b.name) === onlyKind,
    );
    if (firstTool) {
      const line = singleToolDetailLine(firstTool, onlyKind, doneLabels, language);
      if (line) return line;
    }
  }

  // Many clusters, or many calls within one cluster: aggregate-by-kind phrasing.
  const ordered = orderKinds(map);
  const head = ordered.slice(0, MAX_CLUSTERS_IN_LINE);
  const overflow = ordered.length - head.length;
  const phrases = head.map((k) => pluralLabel(k, map.get(k)!.total, doneLabels));
  let line = joinPhrases(phrases, joinLabels);
  if (overflow > 0) {
    line = `${line}${joinLabels.moreSuffix}`;
  }
  return truncate(line, HEADER_LINE_MAX);
}

/**
 * Streaming header text — what the user reads while tools/thinking are still in
 * flight. Prefers the running cluster's progressive-tense label; falls back to
 * "thinking" when no tool has started yet, and to "mixed" when several clusters
 * are running in parallel.
 *
 * Returns `null` if there is nothing meaningful to show (caller may keep the
 * legacy "View N steps" fallback).
 */
export function summarizeClustersStreaming(
  blocks: ReadonlyArray<ThinkingContent | ToolUseContent>,
  ingLabels: StepsClusterIngLabels,
): string | null {
  const map = clusterToolUses(blocks);
  const runningKinds: ActionKind[] = [];
  for (const k of KIND_ORDER) {
    const c = map.get(k);
    if (c && c.running > 0) runningKinds.push(k);
  }

  if (runningKinds.length === 1) {
    return ingLabel(runningKinds[0], ingLabels);
  }
  if (runningKinds.length > 1) {
    return ingLabels.mixed;
  }

  // No tool is currently running.
  const hasStreamingThinking = blocks.some((b) => b.type === 'thinking' && b.streaming);
  if (hasStreamingThinking) {
    return ingLabels.thinking;
  }

  // Some tools may have finished but no streaming token is in flight; fall back
  // to a soft "working" message rather than the developer-y "View N steps".
  if (map.size > 0) {
    return ingLabels.mixed;
  }
  return null;
}
