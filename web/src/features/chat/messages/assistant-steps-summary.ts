// Builder for the live work-log header plus visibility filtering shared by
// the collapsed and expanded states.

import type { ThinkingContent, ToolUseContent } from '@/features/chat/messages/messages.types';
import {
  summarizeClustersStreaming,
  type StepsClusterIngLabels,
} from '@/features/chat/messages/tool-action-cluster';
import type { FriendlyToolTitleLabels } from '@/features/chat/messages/tool-friendly-title';

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

/**
 * Streaming-state header. Returns the progressive-tense action label for the
 * currently running cluster (e.g. "Reading files…"), or `null` when there is
 * no active work to summarize.
 */
export function buildStepsRoundStreamingSummary(
  visibleBlocks: Array<ThinkingContent | ToolUseContent>,
  ingLabels: StepsClusterIngLabels,
  semanticTitle?: (block: ToolUseContent) => string | null,
): string | null {
  return summarizeClustersStreaming(visibleBlocks, ingLabels, semanticTitle);
}
