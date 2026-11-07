import { describe, expect, it } from 'vitest';

import { projectVoiceHistory } from '../voice-history.js';

type Message = { role: string; content?: string; timestamp?: number; summary?: string };
const user = (text: string, timestamp: number): Message => ({ role: 'user', content: text, timestamp });
const reply = (text: string): Message => ({ role: 'assistant', content: text });

describe('voice history request projection', () => {
  it('keeps short history and compaction context unchanged', () => {
    const messages = [{ role: 'system', content: 'Identity and safety.' },
      { role: 'compactionSummary', summary: 'Prior user preferences.' }, user('First', 1), reply('Answer'), user('Now', 2)];
    expect(projectVoiceHistory(messages, 1000)).toEqual({ messages, omittedMessages: 0 });
  });

  it('drops complete old turns while retaining every system instruction and the current execution', () => {
    const messages: Message[] = [{ role: 'system', content: 'Identity and safety.' }, user('Old request', 1),
      reply('x'.repeat(8000)), { role: 'system', content: 'Current approvals.' },
      user('Current request', 2), reply('Tool call'), { role: 'toolResult', content: 'Current result' }];
    const snapshot = structuredClone(messages);
    const projection = projectVoiceHistory(messages, 1000, 2);
    expect(projection.omittedMessages).toBe(2);
    expect(projection.messages).toEqual([messages[0], ...messages.slice(3)]);
    expect(messages).toEqual(snapshot);
  });

  it('keeps all current tool execution across steering messages even when it exceeds the budget', () => {
    const messages = [user('Old request', 1), reply('Old answer'), user('Current request', 2),
      reply('x'.repeat(8000)), { role: 'toolResult', content: 'Current result' }, user('New direction', 3)];
    expect(projectVoiceHistory(messages, 1000, 2).messages).toEqual(messages.slice(2));
  });

  it('retains a bounded prior summary when older detailed turns do not fit', () => {
    const summary = { role: 'compactionSummary', summary: 'Saved preferences.' };
    const messages = [summary, user('Old request', 1), reply('x'.repeat(8000)), user('Current request', 2)];
    expect(projectVoiceHistory(messages, 1000).messages).toEqual([summary, messages.at(-1)]);
  });

  it('bounds an oversized prior summary even with only the current user turn', () => {
    const messages = [{ role: 'compactionSummary', summary: 'x'.repeat(12000) }, user('Current request', 1)];
    expect(projectVoiceHistory(messages, 1000).messages).toEqual([messages[1]]);
  });
});
