import { describe, expect, it } from 'vitest';

import { buildAssistantTurnViewModel } from '@/features/chat/messages/assistant-turn-view-model';
import type { Message, ReasoningLevel } from '@/features/chat/messages/messages.types';

describe('buildAssistantTurnViewModel', () => {
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

    expect(view.activity.blocks).toHaveLength(1);
    expect(view.activity.blocks[0]?.type).toBe('tool_use');
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
    expectedContent: string[];
  }>([
    { level: 'off', expectedContent: ['tool:read-1', 'text:最终答案。'] },
    {
      level: 'on',
      expectedContent: [
        'thinking',
        'text:正在分析。',
        'text:我先检查项目。',
        'tool:read-1',
        'text:最终答案。',
      ],
    },
    {
      level: 'stream',
      expectedContent: [
        'thinking',
        'text:正在分析。',
        'text:我先检查项目。',
        'tool:read-1',
        'text:最终答案。',
      ],
    },
  ])('filters message content for $level activity detail', ({ level, expectedContent }) => {
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
    const contentLabels = view.displayContent.map((block) => {
      if (block.type === 'text') return `text:${block.text}`;
      if (block.type === 'tool_use') return `tool:${block.id}`;
      return block.type;
    });

    expect(contentLabels).toEqual(expectedContent);
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

    expect(view.activity.blocks.map((block) => block.type)).toEqual(expectedTypes);
    expect(view.activity.expandedByDefault).toBe(expanded);
  });
});
