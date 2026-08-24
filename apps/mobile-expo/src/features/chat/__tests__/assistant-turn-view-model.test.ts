import { describe, expect, it } from 'vitest';

import { buildAssistantTurnViewModel } from '../assistant-turn-view-model';

describe('buildAssistantTurnViewModel', () => {
  it('keeps tool activity but hides thinking in concise mode', () => {
    const view = buildAssistantTurnViewModel({
      content: [
        { type: 'thinking', text: 'private analysis' },
        { type: 'tool_use', id: 'tool-1', name: 'read_file', status: 'done' },
        { type: 'text', text: 'Done.', presentation: 'answer' },
      ],
      isStreaming: false,
      reasoningLevel: 'off',
    });

    expect(view.displayContent.some((block) => block.type === 'thinking')).toBe(false);
    expect(view.activity.blocks).toEqual([
      { type: 'tool_use', id: 'tool-1', name: 'read_file', status: 'done' },
    ]);
    expect(view.activity.expandedByDefault).toBe(false);
  });

  it('auto-expands only stream detail before the final answer starts', () => {
    const reasoning = buildAssistantTurnViewModel({
      content: [{ type: 'thinking', text: 'working', streaming: true }],
      isStreaming: true,
      reasoningLevel: 'stream',
    });
    expect(reasoning.activity.expandedByDefault).toBe(true);
    expect(reasoning.showStreamingCursor).toBe(false);

    const answering = buildAssistantTurnViewModel({
      content: [
        { type: 'thinking', text: 'working', streaming: false },
        { type: 'text', text: 'Final answer', presentation: 'answer' },
      ],
      isStreaming: true,
      reasoningLevel: 'stream',
    });
    expect(answering.activity.expandedByDefault).toBe(false);
    expect(answering.showStreamingCursor).toBe(true);

    const normal = buildAssistantTurnViewModel({
      content: [{ type: 'thinking', text: 'working', streaming: true }],
      isStreaming: true,
      reasoningLevel: 'on',
    });
    expect(normal.activity.expandedByDefault).toBe(false);
  });
});
