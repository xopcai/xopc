import { describe, expect, it } from 'vitest';

import type { Message } from '@/features/chat/messages/messages.types';
import { buildAssistantTurnViewModel } from '@/features/chat/messages/assistant-turn-view-model';

function assistantMessage(content: Message['content']): Message {
  return { role: 'assistant', content, timestamp: 1_000 };
}

describe('buildAssistantTurnViewModel', () => {
  it('prioritizes a running tool over pre-tool assistant text', () => {
    const view = buildAssistantTurnViewModel({
      message: assistantMessage([
        { type: 'text', text: 'I will inspect the project.' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'read_file',
          status: 'running',
          startedAt: 2_000,
        },
      ]),
      isStreaming: true,
      reasoningLevel: 'stream',
    });

    expect(view.answerStarted).toBe(true);
    expect(view.lifecycle.state).toBe('using_tool');
    expect(view.lifecycle.activeTool?.name).toBe('read_file');
  });

  it('hides thinking in concise mode without losing tool activity', () => {
    const view = buildAssistantTurnViewModel({
      message: assistantMessage([
        { type: 'thinking', text: 'private analysis', streaming: false },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'read_file',
          status: 'done',
          startedAt: 2_000,
          completedAt: 2_500,
        },
        { type: 'text', text: 'Done.' },
      ]),
      isStreaming: false,
      reasoningLevel: 'off',
    });

    expect(view.displayContent.some((block) => block.type === 'thinking')).toBe(false);
    expect(view.activityBlocks).toHaveLength(1);
    expect(view.lifecycle.durationMs).toBe(500);
  });

  it('separates search evidence from deliverables and reports partial completion', () => {
    const view = buildAssistantTurnViewModel({
      message: assistantMessage([
        {
          type: 'tool_use',
          id: 'search-1',
          name: 'web_search',
          status: 'done',
          result: JSON.stringify({
            results: [{ url: 'https://example.com', title: 'Example' }],
          }),
        },
        {
          type: 'tool_use',
          id: 'write-1',
          name: 'write_file',
          status: 'done',
          result: 'File written: /tmp/report.md',
        },
        {
          type: 'tool_use',
          id: 'failed-1',
          name: 'run_command',
          status: 'error',
        },
      ]),
      isStreaming: false,
      reasoningLevel: 'stream',
    });

    expect(view.sources).toEqual([
      expect.objectContaining({ url: 'https://example.com', title: 'Example' }),
    ]);
    expect(view.deliverables.workspacePaths).toHaveLength(1);
    expect(view.lifecycle.state).toBe('partial');
    expect(view.lifecycle.failedToolCount).toBe(1);
  });
});
