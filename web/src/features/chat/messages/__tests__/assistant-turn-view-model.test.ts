import { describe, expect, it } from 'vitest';

import { buildAssistantTurnViewModel } from '@/features/chat/messages/assistant-turn-view-model';
import type { Message, ReasoningLevel } from '@/features/chat/messages/messages.types';

describe('buildAssistantTurnViewModel', () => {
  it('keeps separate deliveries while deduplicating replayed tool calls', () => {
    const delivery = { version: 2, operation: 'opened', presentation: { kind: 'table', items: [], truncated: false } };
    const block = { type: 'tool_use' as const, id: 'query', name: 'xopc_use', status: 'done' as const, details: { delivery } };
    const view = buildAssistantTurnViewModel({ message: { role: 'assistant', content: [block, { ...block, id: 'other-query' }, block] },
      isStreaming: false, reasoningLevel: 'off' });
    expect(view.deliveries.map(item => item.key)).toEqual(['query', 'other-query']);
  });
  it('keeps a concise tool status visible when activity detail is off', () => {
    const message: Message = {
      role: 'assistant',
      content: [
        { type: 'thinking', text: 'private reasoning', streaming: true },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'read_file',
          status: 'running',
        },
      ],
    };

    const view = buildAssistantTurnViewModel({
      message,
      isStreaming: true,
      reasoningLevel: 'off',
    });

    expect(view.workLog.items).toHaveLength(1);
    expect(view.workLog.items[0]?.type).toBe('tool_use');
    expect(view.lifecycle.state).toBe('using_tool');
  });

  it('does not treat provisional narration as the final answer', () => {
    const message: Message = {
      role: 'assistant',
      content: [
        { type: 'text', text: '我先检查项目。', presentation: 'pending' },
      ],
    };

    const view = buildAssistantTurnViewModel({
      message,
      isStreaming: true,
      reasoningLevel: 'stream',
    });

    expect(view.answer.started).toBe(false);
    expect(view.lifecycle.state).toBe('starting');
  });

  it.each<{
    level: ReasoningLevel;
    expectedWorkLog: string[];
  }>([
    { level: 'off', expectedWorkLog: ['tool:read-1'] },
    {
      level: 'on',
      expectedWorkLog: [
        'thinking',
        'text:正在分析。',
        'text:我先检查项目。',
        'tool:read-1',
      ],
    },
    {
      level: 'stream',
      expectedWorkLog: [
        'thinking',
        'text:正在分析。',
        'text:我先检查项目。',
        'tool:read-1',
      ],
    },
  ])('partitions answer and work log for $level activity detail', ({ level, expectedWorkLog }) => {
    const message: Message = {
      role: 'assistant',
      content: [
        { type: 'thinking', text: 'private reasoning', streaming: false },
        { type: 'text', text: '正在分析。', presentation: 'pending' },
        { type: 'text', text: '我先检查项目。', presentation: 'narration' },
        { type: 'tool_use', id: 'read-1', name: 'read_file', status: 'done' },
        { type: 'text', text: '最终答案。', presentation: 'answer' },
      ],
    };

    const view = buildAssistantTurnViewModel({ message, isStreaming: false, reasoningLevel: level });
    const contentLabels = view.workLog.items.map((block) => {
      if (block.type === 'text') return `text:${block.text}`;
      if (block.type === 'tool_use') return `tool:${block.id}`;
      return block.type;
    });

    expect(contentLabels).toEqual(expectedWorkLog);
    expect(view.answerContent).toEqual([
      { type: 'text', text: '最终答案。', presentation: 'answer' },
    ]);
  });

  it.each<{
    level: ReasoningLevel;
    expectedTypes: string[];
    expanded: boolean;
  }>([
    { level: 'off', expectedTypes: ['tool_use'], expanded: false },
    { level: 'on', expectedTypes: ['thinking', 'tool_use'], expanded: false },
    { level: 'stream', expectedTypes: ['thinking', 'tool_use'], expanded: true },
  ])('applies the $level default expansion policy', ({ level, expectedTypes, expanded }) => {
    const message: Message = {
      role: 'assistant',
      content: [
        { type: 'thinking', text: 'working', streaming: true },
        { type: 'tool_use', id: 'read-1', name: 'read_file', status: 'running' },
      ],
    };

    const view = buildAssistantTurnViewModel({ message, isStreaming: true, reasoningLevel: level });

    expect(view.workLog.items.map((block) => block.type)).toEqual(expectedTypes);
    expect(view.workLog.expandedByDefault).toBe(expanded);
    expect(view.workLog.compact).toBe(level === 'off');
  });

  it('promotes the latest object delivery to the turn result surface', () => {
    const delivery = {
      version: 2,
      operation: 'updated',
      primary: {
        kind: 'note',
        id: 'note-1',
        title: 'Updated note',
        capabilities: ['open'],
      },
    } as const;
    const message: Message = {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'note-update',
          name: 'xopc_use',
          status: 'done',
          result: `Updated\nxopc-product-delivery:${encodeURIComponent(JSON.stringify(delivery))}`,
        },
        {
          type: 'tool_use',
          id: 'send-final',
          name: 'send_message',
          status: 'done',
          result: 'Message sent',
        },
      ],
    };

    const view = buildAssistantTurnViewModel({
      message,
      isStreaming: false,
      reasoningLevel: 'off',
    });

    expect(view.deliveries).toEqual([{ key: 'note-update', delivery }]);
  });

  it('does not promote a note delivery that only opens an existing note', () => {
    const delivery = {
      version: 2,
      operation: 'opened',
      primary: {
        kind: 'note',
        id: 'note-1',
        title: 'Existing note',
        capabilities: ['open'],
      },
    } as const;
    const message: Message = {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'note-open',
          name: 'xopc_use',
          status: 'done',
          result: `Opened\nxopc-product-delivery:${encodeURIComponent(JSON.stringify(delivery))}`,
        },
      ],
    };

    const view = buildAssistantTurnViewModel({
      message,
      isStreaming: false,
      reasoningLevel: 'off',
    });

    expect(view.deliveries).toEqual([]);
  });
});
