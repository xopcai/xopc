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
  const completedAt = completions.length > 0 ? Math.max(...completions) : undefined;
  const durationMs =
    startedAt != null && completedAt != null
      ? Math.max(0, completedAt - startedAt)
      : undefined;

  return { startedAt, completedAt, durationMs };
}
