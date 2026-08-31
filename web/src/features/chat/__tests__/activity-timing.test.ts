import { describe, expect, it } from 'vitest';

import { getActivityTiming } from '@/features/chat/messages/activity-timing';
import type { ToolUseContent } from '@/features/chat/messages/messages.types';

function tool(
  id: string,
  startedAt?: number,
  completedAt?: number,
): ToolUseContent {
  return {
    type: 'tool_use',
    id,
    name: 'test_tool',
    status: completedAt == null ? 'running' : 'done',
    startedAt,
    completedAt,
  };
}

describe('getActivityTiming', () => {
  it('uses the earliest start and latest completion across a turn', () => {
    expect(getActivityTiming([
      tool('a', 1_000, 2_000),
      tool('b', 1_500, 4_250),
    ])).toEqual({
      startedAt: 1_000,
      completedAt: 4_250,
      durationMs: 3_250,
    });
  });

  it('keeps duration open while only a start is available', () => {
    expect(getActivityTiming([tool('a', 1_000)])).toEqual({
      startedAt: 1_000,
      completedAt: undefined,
      durationMs: undefined,
    });
  });

  it('returns optional fields when no tool timing is present', () => {
    expect(getActivityTiming([tool('a')])).toEqual({
      startedAt: undefined,
      completedAt: undefined,
      durationMs: undefined,
    });
  });

  it('extends the activity window to the observed run end', () => {
    expect(getActivityTiming([
      tool('a', 1_000, 2_000),
    ], 5_000)).toEqual({
      startedAt: 1_000,
      completedAt: 5_000,
      durationMs: 4_000,
    });
  });
});
