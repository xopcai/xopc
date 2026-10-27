import { describe, expect, it } from 'vitest';

import { assistantAnswerContent } from '../assistant-turn-content';
import { groupAssistantActivity } from '../assistant-activity-groups';
import { buildAssistantTurnViewModel } from '../assistant-turn-view-model';
import { mergeConsecutiveAssistantMessages, sessionWireToUiMessages } from '../agent-messages';
import type { MessageContent, ToolUseContent } from '../messages.types';

const tool = (id: string): ToolUseContent => ({ type: 'tool_use', id, name: 'read_file', status: 'done' });

describe('assistant turn projection', () => {
  it('keeps earlier tool-free responses in the process when the model continues', () => {
    const content: MessageContent[] = [
      { type: 'text', text: 'Checking', presentation: 'answer', segmentId: 'first' },
      { type: 'text', text: 'Done', presentation: 'answer', segmentId: 'final' },
    ];
    expect(assistantAnswerContent(content)).toEqual([content[1]]);
    expect(content[0]).toMatchObject({ presentation: 'answer' });
  });

  it('never treats pre-tool text as the final answer, including legacy blocks without presentation', () => {
    const content: MessageContent[] = [
      { type: 'text', text: 'I will inspect this.' }, tool('read'),
      { type: 'thinking', text: 'reasoning' },
      { type: 'text', text: 'First paragraph' }, { type: 'text', text: 'Second paragraph' },
    ];
    expect(assistantAnswerContent(content)).toEqual(content.slice(3));
  });

  it('does not promote interrupted pending text', () => {
    const content: MessageContent[] = [{ type: 'text', text: 'Unfinished draft', presentation: 'pending' }];
    expect(assistantAnswerContent(content)).toEqual([]);
    const view = buildAssistantTurnViewModel({ message: { role: 'assistant', content },
      isStreaming: false, reasoningLevel: 'on' });
    expect(view.answerContent).toEqual(content);
    expect(view.workLog.items).toEqual([]);
    expect(view.workLog.expandedByDefault).toBe(false);
  });

  it('uses the same final result after SQLite wire hydration and live aggregation', () => {
    const messages = sessionWireToUiMessages([
      { role: 'assistant', timestamp: 1000, content: [
        { type: 'text', text: 'Reading files.' },
        { type: 'toolCall', id: 'read', name: 'read_file', arguments: { path: 'one.txt' } },
      ] },
      { role: 'toolResult', toolCallId: 'read', timestamp: 2000, content: 'ok' },
      { role: 'assistant', timestamp: 3000, content: [{ type: 'text', text: 'Final result.' }] },
    ]);
    expect(messages).toHaveLength(1);
    expect(assistantAnswerContent(messages[0].content)).toMatchObject([{ text: 'Final result.' }]);
    const [merged] = mergeConsecutiveAssistantMessages([
      { role: 'assistant', timestamp: 1000, content: [tool('read')] },
      { role: 'assistant', timestamp: 3000, completedAt: 5000, content: [{ type: 'text', text: 'Final result.' }] },
    ]);
    expect(merged).toMatchObject({ startedAt: 1000, timestamp: 3000, completedAt: 5000 });
    expect(buildAssistantTurnViewModel({ message: merged, isStreaming: false, reasoningLevel: 'on' })
      .workLog.durationMs).toBe(4000);
  });
});

describe('assistant activity groups', () => {
  it('aggregates only adjacent tools and preserves narration, thinking, and child calls', () => {
    const narration = { type: 'text' as const, text: 'Next phase', presentation: 'narration' as const };
    const thinking = { type: 'thinking' as const, text: 'thinking' };
    const tools = [tool('one'), { ...tool('two'), parentToolCallId: 'one' }, tool('three')];
    expect(groupAssistantActivity([tools[0], tools[1], narration, thinking, tools[2]])).toEqual([
      { type: 'tools', tools: tools.slice(0, 2) },
      { type: 'item', item: narration }, { type: 'item', item: thinking },
      { type: 'tools', tools: [tools[2]] },
    ]);
  });
});
