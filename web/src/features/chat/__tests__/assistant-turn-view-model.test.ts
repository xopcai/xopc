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

    expect(view.answer.started).toBe(true);
    expect(view.answer.showStreamingCursor).toBe(false);
    expect(view.lifecycle.state).toBe('using_tool');
    expect(view.lifecycle.activeTool?.name).toBe('read_file');
  });

  it('keeps tool activity visible in concise mode while hiding reasoning', () => {
    const view = buildAssistantTurnViewModel({
      message: assistantMessage([
        { type: 'thinking', text: 'private analysis', streaming: false },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'read_file',
          status: 'error',
          startedAt: 2_000,
          completedAt: 2_500,
        },
        { type: 'text', text: 'Done.' },
      ]),
      isStreaming: false,
      reasoningLevel: 'off',
    });

    expect(view.displayContent.some((block) => block.type === 'thinking')).toBe(false);
    expect(view.activity.blocks).toHaveLength(1);
    expect(view.activity.hasTool).toBe(true);
    expect(view.activity.failedCount).toBe(1);
    expect(view.activity.expandedByDefault).toBe(false);
    expect(view.activity.durationMs).toBe(500);
  });

  it('retains a structured tool failure when transport completion succeeded', () => {
    const view = buildAssistantTurnViewModel({
      message: assistantMessage([{
        type: 'tool_use',
        id: 'memory-1',
        name: 'memory_search',
        status: 'done',
        activity: {
          category: 'memory', action: 'search', status: 'failed', source: 'memory', sensitivity: 'personal',
        },
      }]),
      isStreaming: false,
      reasoningLevel: 'stream',
    });

    expect(view.lifecycle.state).toBe('partial');
    expect(view.activity.failedCount).toBe(1);
  });

  it('opens live reasoning and moves the cursor to the answer once text starts', () => {
    const reasoning = buildAssistantTurnViewModel({
      message: assistantMessage([
        { type: 'thinking', text: 'working', streaming: true },
      ]),
      isStreaming: true,
      reasoningLevel: 'stream',
    });

    expect(reasoning.lifecycle.state).toBe('reasoning');
    expect(reasoning.activity.active).toBe(true);
    expect(reasoning.activity.expandedByDefault).toBe(true);
    expect(reasoning.answer.showStreamingCursor).toBe(false);

    const answering = buildAssistantTurnViewModel({
      message: assistantMessage([
        { type: 'thinking', text: 'working', streaming: false },
        { type: 'text', text: 'Final answer' },
      ]),
      isStreaming: true,
      reasoningLevel: 'stream',
    });

    expect(answering.lifecycle.state).toBe('answering');
    expect(answering.activity.expandedByDefault).toBe(false);
    expect(answering.answer.showStreamingCursor).toBe(true);
  });

  it('normalizes stale running blocks after the stream closes', () => {
    const view = buildAssistantTurnViewModel({
      message: assistantMessage([
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'read_file',
          status: 'running',
          startedAt: 2_000,
        },
      ]),
      isStreaming: false,
      reasoningLevel: 'stream',
    });

    expect(view.lifecycle.state).toBe('completed');
    expect(view.lifecycle.activeTool).toBeUndefined();
    expect(view.activity.active).toBe(false);
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
    expect(view.activity.failedCount).toBe(1);
  });
});
