// Tool-action clustering for the live work-log header.
//
// Pure module — no React, no i18n loader. Callers pass label bags so this stays
// trivially testable in both languages.

import type { ThinkingContent, ToolUseContent } from '@/features/chat/messages/messages.types';
import {
  classifyToolDisplay,
  type ToolDisplayKind,
} from '@/features/chat/messages/tool-friendly-title';

export type ActionKind = ToolDisplayKind;

export type ClusterCount = { total: number; running: number };

export type ClusterMap = Map<ActionKind, ClusterCount>;

export type StepsClusterIngLabels = Record<
  | 'thinking'
  | 'webSearch'
  | 'memorySearch'
  | 'codeSearch'
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

/** Ordered for stable output when summarizing multiple clusters. */
const KIND_ORDER: ActionKind[] = [
  'readFile',
  'editFile',
  'writeFile',
  'runCommand',
  'memorySearch',
  'codeSearch',
  'webSearch',
  'search',
  'fetchUrl',
  'openUrl',
  'listDir',
  'other',
];

export function classifyTool(name: string, activity?: ToolUseContent['activity']): ActionKind {
  return classifyToolDisplay(name, activity);
}

export function clusterToolUses(
  blocks: ReadonlyArray<ThinkingContent | ToolUseContent>,
): ClusterMap {
  const out: ClusterMap = new Map();
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue;
    const kind = classifyTool(b.name, b.activity);
    const cur = out.get(kind) ?? { total: 0, running: 0 };
    cur.total += 1;
    if ((b.status === 'running' || b.activity?.status === 'running')) cur.running += 1;
    out.set(kind, cur);
  }
  return out;
}

function ingLabel(kind: ActionKind, labels: StepsClusterIngLabels): string {
  switch (kind) {
    case 'webSearch':
      return labels.webSearch;
    case 'memorySearch':
      return labels.memorySearch;
    case 'codeSearch':
      return labels.codeSearch;
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

export function actionKindRunningLabel(
  kind: ActionKind,
  labels: StepsClusterIngLabels,
): string {
  return ingLabel(kind, labels);
}

/**
 * Streaming header text — what the user reads while tools/thinking are still in
 * flight. Prefers the running cluster's progressive-tense label; falls back to
 * "thinking" when no tool has started yet, and to "mixed" when several clusters
 * are running in parallel.
 *
 * Returns `null` if there is nothing meaningful to show.
 */
export function summarizeClustersStreaming(
  blocks: ReadonlyArray<ThinkingContent | ToolUseContent>,
  ingLabels: StepsClusterIngLabels,
  semanticTitle?: (block: ToolUseContent) => string | null,
): string | null {
  const map = clusterToolUses(blocks);
  const runningKinds: ActionKind[] = [];
  for (const k of KIND_ORDER) {
    const c = map.get(k);
    if (c && c.running > 0) runningKinds.push(k);
  }

  if (runningKinds.length === 1) {
    const runningTool = [...blocks].reverse().find(
      (block): block is ToolUseContent => block.type === 'tool_use' && (block.status === 'running' || block.activity?.status === 'running'),
    );
    const semantic = runningTool ? semanticTitle?.(runningTool) : null;
    if (semantic) return semantic;
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

  // Some tools may have finished but no streaming token is in flight; keep the
  // activity header stable with a soft "working" message.
  if (map.size > 0) {
    return ingLabels.mixed;
  }
  return null;
}
