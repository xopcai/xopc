import { describe, expect, it } from 'vitest';

import { flattenMessageContent, messagesToClientHistory } from '../client-history.js';
import type { Message } from '../types.js';

describe('messagesToClientHistory', () => {
  it('flattens user and assistant text', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
    ];
    const out = messagesToClientHistory(messages);
    expect(out).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello', toolCalls: undefined },
    ]);
  });

  it('merges tool results into assistant toolCalls', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'demo', arguments: '{"x":1}' },
          },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'text', text: 'done' }],
        tool_call_id: 'call_1',
      },
    ];
    const out = messagesToClientHistory(messages);
    expect(out).toHaveLength(1);
    expect(out[0]!.role).toBe('assistant');
    expect(out[0]!.toolCalls?.[0]?.name).toBe('demo');
    expect(out[0]!.toolCalls?.[0]?.args).toEqual({ x: 1 });
    expect(out[0]!.toolCalls?.[0]?.result).toBe('done');
  });

  it('respects limit on raw messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'user', content: 'c' },
    ];
    const out = messagesToClientHistory(messages, { limit: 2 });
    expect(out.map((m) => m.content)).toEqual(['b', 'c']);
  });
});

describe('flattenMessageContent', () => {
  it('joins text blocks', () => {
    expect(flattenMessageContent([{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }])).toBe(
      'xy',
    );
  });
});
