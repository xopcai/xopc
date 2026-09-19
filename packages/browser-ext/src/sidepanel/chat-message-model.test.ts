import { describe, expect, it } from 'vitest';

import { messageText, normalizeChatMessages } from './chat-message-model';

describe('browser chat message normalization', () => {
  it('prefers structured raw content and keeps thinking and tools', () => {
    const messages = normalizeChatMessages([{
      id: 'assistant-1',
      role: 'assistant',
      content: 'flattened fallback',
      rawContent: [
        { type: 'thinking', thinking: 'inspect first' },
        { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } },
        { type: 'text', text: 'answer' },
      ],
    }]);

    expect(messages[0]?.blocks).toMatchObject([
      { type: 'thinking', text: 'inspect first' },
      { type: 'tool', toolCallId: 'call-1', name: 'read_file' },
      { type: 'text', text: 'answer' },
    ]);
    expect(messageText(messages[0]!)).toBe('answer');
  });

  it('merges tool result rows and consecutive assistant fragments', () => {
    const messages = normalizeChatMessages([
      { role: 'assistant', rawContent: [{ type: 'thinking', text: 'look' }, { type: 'tool_use', id: 'call-1', name: 'web_search' }] },
      { role: 'toolResult', toolCallId: 'call-1', content: [{ type: 'text', text: 'two results' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'finished' }] },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks).toMatchObject([
      { type: 'thinking', text: 'look' },
      { type: 'tool', toolCallId: 'call-1', status: 'done', result: 'two results' },
      { type: 'text', text: 'finished' },
    ]);
  });

  it('restores declared tool calls and safe attachment metadata', () => {
    const messages = normalizeChatMessages([{
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-2', name: 'exec_command', args: { command: 'pwd' }, result: 'ok' }],
      media: [{ type: 'photo', mimeType: 'image/png', name: 'image.png', size: 4, path: '/secret', data: 'AAAA' }],
    }]);

    expect(messages[0]).toMatchObject({
      attachments: [{ type: 'image', mimeType: 'image/png', name: 'image.png', size: 4 }],
      blocks: [{ type: 'tool', toolCallId: 'call-2', status: 'done' }],
    });
    expect(JSON.stringify(messages)).not.toContain('/secret');
    expect(JSON.stringify(messages)).not.toContain('AAAA');
  });
});
