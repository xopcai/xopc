import { describe, expect, it } from 'vitest';

import { findSessionMessages } from '../session-find.js';
import type { Message } from '../types.js';

describe('findSessionMessages', () => {
  it('returns ordered literal occurrences in user and assistant text', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Ticket 8318 and 8318' },
      { role: 'assistant', content: [
        { type: 'text', text: 'Resolved 8318' },
        { type: 'text', text: 'Hidden 8318', presentation: 'narration' },
        { type: 'tool_use', name: '8318' },
      ] },
      { role: 'tool', content: '8318' },
    ];

    expect(findSessionMessages(messages, '8318')).toEqual({
      query: '8318',
      total: 3,
      truncated: false,
      matches: [
        { displayIndex: 0, occurrence: 0 },
        { displayIndex: 0, occurrence: 1 },
        { displayIndex: 1, occurrence: 0 },
      ],
    });
  });

  it('is case insensitive and reports truncation without losing the exact total', () => {
    const messages: Message[] = [{ role: 'assistant', content: 'Alpha alpha ALPHA' }];
    expect(findSessionMessages(messages, 'alpha', 2)).toMatchObject({
      total: 3,
      truncated: true,
      matches: [{ displayIndex: 0, occurrence: 0 }, { displayIndex: 0, occurrence: 1 }],
    });
  });

  it('searches rendered markdown text rather than hidden link targets', () => {
    const messages: Message[] = [{
      role: 'assistant',
      content: '[release notes](https://example.com/internal-id)',
    }];
    expect(findSessionMessages(messages, 'release notes').total).toBe(1);
    expect(findSessionMessages(messages, 'internal-id').total).toBe(0);
  });

  it('uses visible bubble indexes and continues occurrences across assistant fragments', () => {
    const messages = [
      { role: 'user', content: 'Question', displayIndex: 0 },
      { role: 'assistant', content: 'Happy', displayIndex: 1 },
      { role: 'toolResult', content: 'Happy', displayIndex: 1 },
      { role: 'assistant', content: 'Happy again', displayIndex: 1 },
      { role: 'user', content: 'Happy', displayIndex: 2 },
    ];

    expect(findSessionMessages(messages, 'happy')).toEqual({
      query: 'happy',
      total: 3,
      truncated: false,
      matches: [
        { displayIndex: 1, occurrence: 0 },
        { displayIndex: 1, occurrence: 1 },
        { displayIndex: 2, occurrence: 0 },
      ],
    });
  });
});
