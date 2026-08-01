// Builders for the collapsed "steps round" header — the streaming-state line
// ("Reading files…") and the post-round summary ("Read 3 files, edited 1") —
// plus the small helpers (`filterVisibleSteps`, `viewStepsLabel`) shared
// between the collapsed and expanded states.

import type { ThinkingContent, ToolUseContent } from '@/features/chat/messages/messages.types';
import {
  summarizeClustersCompleted,
  summarizeClustersStreaming,
  type StepsClusterDoneLabels,
  type StepsClusterIngLabels,
  type StepsClusterJoinLabels,
} from '@/features/chat/messages/tool-action-cluster';
import type { FriendlyToolTitleLabels } from '@/features/chat/messages/tool-friendly-title';
import type { StoredLanguage } from '@/lib/storage';

export type FirstToolHeaderLabels = FriendlyToolTitleLabels;

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

/**
 * One-line "what happened" when a tool round finishes — aggregates tool uses
 * by action kind (e.g. "Read 3 files, edited 1"). Single-call rounds keep the
 * familiar "Title: detail" format so power users don't lose information density.
 *
 * Falls back to `noToolFallback` when the round contains no tool uses (e.g.
 * thinking-only).
 */
export function buildStepsRoundCompleteSummary(
  visibleBlocks: Array<ThinkingContent | ToolUseContent>,
  doneLabels: StepsClusterDoneLabels,
  joinLabels: StepsClusterJoinLabels,
  language: StoredLanguage,
  noToolFallback: string,
): string {
  const line = summarizeClustersCompleted(visibleBlocks, doneLabels, joinLabels, language);
  return line ?? noToolFallback;
}

/**
 * Streaming-state header. Returns the progressive-tense action label for the
 * currently running cluster (e.g. "Reading files…"), or `null` when there is
 * no active work to summarize.
 */
export function buildStepsRoundStreamingSummary(
  visibleBlocks: Array<ThinkingContent | ToolUseContent>,
  ingLabels: StepsClusterIngLabels,
): string | null {
  return summarizeClustersStreaming(visibleBlocks, ingLabels);
}
