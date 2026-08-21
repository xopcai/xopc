import { describe, expect, it } from 'vitest';

import { buildAssistantTurnViewModel } from '@/features/chat/messages/assistant-turn-view-model';
import type { Message } from '@/features/chat/messages/messages.types';

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
});
