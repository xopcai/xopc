import { describe, expect, it } from 'vitest';

import type { Message } from '../messages.types';
import { sessionContainsFinalAssistant } from '../session-refresh-confirmation';

const user: Message = {
  id: 'user-1',
  role: 'user',
  content: [{ type: 'text', text: 'Question' }],
};

const finalMessage: Message = {
  id: 'stream-1',
  turnId: 'turn-1',
  role: 'assistant',
  content: [{ type: 'text', text: 'Complete answer', segmentId: 'answer-1' }],
};

describe('session refresh confirmation', () => {
  it('does not accept a newer but stale history snapshot', () => {
    expect(sessionContainsFinalAssistant([user], finalMessage)).toBe(false);
  });

  it('does not accept a partial assistant snapshot from the same turn', () => {
    expect(sessionContainsFinalAssistant([user, {
      ...finalMessage,
      id: 'stored-1',
      content: [{ type: 'text', text: 'Complete' }],
    }], finalMessage)).toBe(false);
  });

  it('accepts the durable completed answer and permits extra canonical text', () => {
    expect(sessionContainsFinalAssistant([user, {
      ...finalMessage,
      id: 'stored-1',
      content: [{ type: 'text', text: 'Complete answer with server suffix' }],
    }], finalMessage)).toBe(true);
  });

  it('supports legacy transcript rows without turn ids when text is complete', () => {
    expect(sessionContainsFinalAssistant([user, {
      id: 'stored-1',
      role: 'assistant',
      content: [{ type: 'text', text: 'Complete answer' }],
    }], finalMessage)).toBe(true);
  });

  it('requires completed tool results as well as text', () => {
    const finalWithTool: Message = {
      ...finalMessage,
      content: [
        ...finalMessage.content,
        { type: 'tool_use', id: 'tool-1', name: 'read_file', status: 'done' },
      ],
    };
    expect(sessionContainsFinalAssistant([user, {
      ...finalMessage,
      id: 'stored-1',
    }], finalWithTool)).toBe(false);
    expect(sessionContainsFinalAssistant([user, {
      ...finalWithTool,
      id: 'stored-1',
    }], finalWithTool)).toBe(true);
  });

  it('never matches an identical assistant from before the latest user turn', () => {
    expect(sessionContainsFinalAssistant([
      { ...finalMessage, id: 'old-answer' },
      user,
    ], finalMessage)).toBe(false);
  });
});
