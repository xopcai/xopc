import { describe, it, expect } from 'vitest';
import { sessionWireToUiMessages } from '../agent-messages.js';

describe('sessionWireToUiMessages', () => {
  it('merges toolResult into assistant tool_use blocks', () => {
    const raw = [
      { role: 'user', content: 'run ls', timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', name: 'bash', id: 'tc1', args: { command: 'ls' } }],
        timestamp: 2,
      },
      {
        role: 'toolResult',
        content: 'file.txt',
        tool_call_id: 'tc1',
        timestamp: 3,
      },
    ];

    const messages = sessionWireToUiMessages(raw);
    expect(messages).toHaveLength(2);
    const assistant = messages[1];
    expect(assistant.role).toBe('assistant');
    const tool = assistant.content.find((b) => b.type === 'tool_use');
    expect(tool?.type).toBe('tool_use');
    if (tool?.type === 'tool_use') {
      expect(tool.result).toBe('file.txt');
      expect(tool.status).toBe('done');
    }
  });

  it('maps toolCall blocks with session `arguments` (not only args)', () => {
    const raw = [
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call1',
            name: 'find',
            arguments: { pattern: '**/*.md', path: '/proj', limit: 30 },
          },
        ],
        timestamp: 1,
      },
    ];

    const messages = sessionWireToUiMessages(raw);
    const tool = messages[0].content.find((b) => b.type === 'tool_use');
    expect(tool?.type).toBe('tool_use');
    if (tool?.type === 'tool_use') {
      expect(tool.input).toEqual({ pattern: '**/*.md', path: '/proj', limit: 30 });
    }
  });

  it('maps OpenAI tool_calls on assistant messages', () => {
    const raw = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_a',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
          },
        ],
        timestamp: 1,
      },
    ];

    const messages = sessionWireToUiMessages(raw);
    expect(messages).toHaveLength(1);
    const tool = messages[0].content.find((b) => b.type === 'tool_use');
    expect(tool?.type).toBe('tool_use');
    if (tool?.type === 'tool_use') {
      expect(tool.name).toBe('read_file');
      expect(tool.id).toBe('call_a');
      expect(tool.input).toEqual({ path: 'a.ts' });
    }
  });
});
