import { describe, expect, it } from 'vitest';

import { computeUserRoundDeleteRange } from '../user-round-delete.js';
import type { Message } from '../types.js';

describe('computeUserRoundDeleteRange', () => {
  it('deletes user plus plain assistant reply', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(computeUserRoundDeleteRange(messages, 0)).toEqual({ startIndex: 0, count: 2 });
  });

  it('deletes user plus assistant tool loop rows', () => {
    const messages: Message[] = [
      { role: 'user', content: 'search' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'web_search', arguments: '{}' },
          },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'text', text: 'results' }],
        tool_call_id: 'call_1',
      },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    expect(computeUserRoundDeleteRange(messages, 0)).toEqual({ startIndex: 0, count: 4 });
  });

  it('targets the requested user round only', () => {
    const messages: Message[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'A' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'B' },
    ];
    expect(computeUserRoundDeleteRange(messages, 1)).toEqual({ startIndex: 2, count: 2 });
  });

  it('returns null when user round is out of range', () => {
    const messages: Message[] = [{ role: 'user', content: 'a' }];
    expect(computeUserRoundDeleteRange(messages, 1)).toBeNull();
  });
});
