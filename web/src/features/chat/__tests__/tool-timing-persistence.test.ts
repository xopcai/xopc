import { describe, expect, it } from 'vitest';

import { sessionWireToUiMessages } from '@/features/chat/messages/agent-messages';
import type { MessageContent, ToolUseContent } from '@/features/chat/messages/messages.types';
import {
  appendToolStart,
  completeTool,
} from '@/features/chat/messages/streaming';

function firstTool(content: MessageContent[]): ToolUseContent {
  const block = content.find(
    (item): item is ToolUseContent => item.type === 'tool_use',
  );
  if (!block) throw new Error('Expected a tool block');
  return block;
}

describe('tool activity timing', () => {
  it('keeps SSE lifecycle timestamps on the live tool block', () => {
    const content: MessageContent[] = [];
    appendToolStart(content, 'web_search', { query: 'xopc' }, 'call-1', 1_000);
    completeTool(content, 'web_search', false, 'ok', 'call-1', 3_750);

    expect(firstTool(content)).toMatchObject({
      toolCallId: 'call-1',
      startedAt: 1_000,
      completedAt: 3_750,
      durationMs: 2_750,
      status: 'done',
    });
  });

  it('reconstructs lifecycle timing from persisted assistant and tool-result rows', () => {
    const messages = sessionWireToUiMessages([
      {
        role: 'assistant',
        timestamp: 10_000,
        rawContent: [{
          type: 'tool_use',
          id: 'call-1',
          name: 'read_file',
          input: { path: 'README.md' },
        }],
      },
      {
        role: 'toolResult',
        timestamp: 12_500,
        toolCallId: 'call-1',
        content: [{ type: 'text', text: 'contents' }],
      },
    ]);

    expect(firstTool(messages[0].content)).toMatchObject({
      toolCallId: 'call-1',
      startedAt: 10_000,
      completedAt: 12_500,
      durationMs: 2_500,
      status: 'done',
    });
  });
});
