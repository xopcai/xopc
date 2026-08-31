import type {
  ThinkingContent,
  ToolUseContent,
} from '@/features/chat/messages/messages.types';

export type ActivityTiming = {
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
};

/**
 * Derive a stable turn-level activity window from tool lifecycle metadata.
 * Tool timestamps are supplied by the current stream and transcript formats.
 */
export function getActivityTiming(
  blocks: ReadonlyArray<ThinkingContent | ToolUseContent>,
  activityEndedAt?: number,
): ActivityTiming {
  const tools = blocks.filter(
    (block): block is ToolUseContent => block.type === 'tool_use',
  );
  const starts = tools
    .map((tool) => tool.startedAt)
    .filter((value): value is number => Number.isFinite(value));
  const completions = tools
    .map((tool) => tool.completedAt)
    .filter((value): value is number => Number.isFinite(value));

  const startedAt = starts.length > 0 ? Math.min(...starts) : undefined;
  const completedAtCandidates = [
    ...completions,
    ...(Number.isFinite(activityEndedAt) ? [activityEndedAt as number] : []),
  ];
  const completedAt = completedAtCandidates.length > 0
    ? Math.max(...completedAtCandidates)
    : undefined;
  const durationMs =
    startedAt != null && completedAt != null
      ? Math.max(0, completedAt - startedAt)
      : undefined;

  return { startedAt, completedAt, durationMs };
}
