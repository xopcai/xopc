import { describe, expect, it } from 'vitest';

import {
  collectConversationChangeSummary,
  extractConversationPlan,
} from '@/features/chat/messages/conversation-plan';
import type { MessageContent, ToolUseContent } from '@/features/chat/messages/messages.types';

function tool(
  name: string,
  details: unknown,
  overrides: Partial<ToolUseContent> = {},
): ToolUseContent {
  return {
    type: 'tool_use',
    id: `${name}-1`,
    name,
    status: 'done',
    details,
    ...overrides,
  };
}

describe('extractConversationPlan', () => {
  it('adapts the latest update_plan snapshot', () => {
    const content: MessageContent[] = [
      tool('update_plan', {
        explanation: 'Initial plan',
        plan: [
          { step: 'Inspect', status: 'in_progress' },
          { step: 'Implement', status: 'pending' },
        ],
      }),
      tool('update_plan', {
        explanation: 'Implementation started',
        plan: [
          { step: 'Inspect', status: 'completed' },
          { step: 'Implement', status: 'in_progress' },
        ],
      }, { id: 'update-plan-2' }),
    ];

    expect(extractConversationPlan(content)).toMatchObject({
      source: 'update_plan',
      explanation: 'Implementation started',
      currentIndex: 2,
      completedCount: 1,
      totalCount: 2,
    });
  });

  it('adapts todo details and keeps cancelled items', () => {
    expect(extractConversationPlan([
      tool('todo', {
        items: [
          { id: 'a', content: 'First', status: 'completed' },
          { id: 'b', content: 'Second', status: 'cancelled' },
        ],
      }),
    ])).toMatchObject({
      source: 'todo',
      completedCount: 1,
      totalCount: 2,
      items: [
        { id: 'a', title: 'First', status: 'completed' },
        { id: 'b', title: 'Second', status: 'cancelled' },
      ],
    });
  });

  it('reads live structured tool results and ignores malformed snapshots', () => {
    const live = tool('update_plan', undefined, {
      details: undefined,
      result: JSON.stringify({
        content: [],
        details: { plan: [{ step: 'Ship', status: 'in_progress' }] },
      }),
    });
    expect(extractConversationPlan([tool('todo', { items: [] }), live])?.items[0]).toMatchObject({
      title: 'Ship',
      status: 'in_progress',
    });
  });

  it('does not infer plans from ordinary text', () => {
    expect(extractConversationPlan([{ type: 'text', text: '- [ ] not authoritative' }])).toBeNull();
  });
});

describe('collectConversationChangeSummary', () => {
  it('deduplicates files and sums patch counts', () => {
    const content: MessageContent[] = [
      tool('apply_patch', { files: ['a.ts', 'b.ts'], added: 5, removed: 2 }),
      tool('apply_patch', { files: ['a.ts'], added: 3, removed: 1 }, { id: 'patch-2' }),
    ];
    expect(collectConversationChangeSummary(content)).toEqual({
      files: ['a.ts', 'b.ts'],
      added: 8,
      removed: 3,
    });
  });
});
