import { describe, expect, it } from 'vitest';

import {
  collectConversationChangeSummary,
  extractConversationPlan,
  extractLatestConversationPlan,
} from '@/features/chat/messages/conversation-plan';
import type { Message, MessageContent, ToolUseContent } from '@/features/chat/messages/messages.types';

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

  it('extracts the latest plan snapshot from the current session', () => {
    const sessionMessages: Message[] = [
      {
        role: 'assistant',
        content: [tool('todo', {
          items: [{ id: 'old', content: 'Old task', status: 'in_progress' }],
        })],
      },
      { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
      {
        role: 'assistant',
        content: [
          tool('todo', {
            items: [{ id: 'latest', content: 'Latest task', status: 'in_progress' }],
          }, { id: 'todo-latest' }),
          tool('apply_patch', { files: ['latest.ts'], added: 4, removed: 1 }),
        ],
      },
    ];

    expect(extractLatestConversationPlan(sessionMessages)).toMatchObject({
      plan: {
        source: 'todo',
        items: [{ id: 'latest', title: 'Latest task', status: 'in_progress' }],
      },
      changeSummary: { files: ['latest.ts'], added: 4, removed: 1 },
    });
  });

  it('treats an empty latest Todo snapshot as clearing the session plan', () => {
    const sessionMessages: Message[] = [
      {
        role: 'assistant',
        content: [tool('todo', {
          items: [{ id: 'stale', content: 'Stale task', status: 'pending' }],
        })],
      },
      {
        role: 'assistant',
        content: [tool('todo', { items: [] }, { id: 'todo-clear' })],
      },
    ];

    expect(extractLatestConversationPlan(sessionMessages)).toBeNull();
  });

  it('hides a session plan after every item is completed or cancelled', () => {
    const sessionMessages: Message[] = [
      {
        role: 'assistant',
        content: [tool('todo', {
          items: [
            { id: 'done', content: 'Completed task', status: 'completed' },
            { id: 'cancelled', content: 'Cancelled task', status: 'cancelled' },
          ],
        })],
      },
    ];

    expect(extractLatestConversationPlan(sessionMessages)).toBeNull();
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
