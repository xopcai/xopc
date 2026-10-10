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
  it('keeps nested identity and uses execution duration instead of realtime transit time', () => {
    const content: MessageContent[] = [];
    appendToolStart(content, 'read_file', {}, 'script/1', 1000, undefined, { parentToolCallId: 'script' });
    completeTool(content, 'read_file', false, 'ok', 'script/1', 4000, undefined, { parentToolCallId: 'script', durationMs: 13 });
    expect(firstTool(content)).toMatchObject({ parentToolCallId: 'script', durationMs: 13 });
  });

  it('reconstructs child audit rows without inventing model toolResult messages', () => {
    const messages = sessionWireToUiMessages([
      { role: 'assistant', timestamp: 1000, rawContent: [{ type: 'tool_use', id: 'script', name: 'codemode', input: { code: '' } }] },
      { role: 'toolResult', toolCallId: 'script', timestamp: 2000, durationMs: 900, content: 'done',
        nestedCalls: { calls: [{ id: 'script/1', name: 'read_file', status: 'ok', durationMs: 13, arguments: { path: 'note.txt' } }], complete: true } },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'codemode', durationMs: 900 }),
      expect.objectContaining({ parentToolCallId: 'script', name: 'read_file', status: 'done', durationMs: 13 }),
    ]));
  });
  it('keeps run lifecycle timestamps on the live tool block', () => {
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
