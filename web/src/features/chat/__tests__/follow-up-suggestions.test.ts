import { describe, expect, it } from 'vitest';

import { suggestFollowUpsFromAssistantMessage } from '@/features/chat/follow-up-suggestions';
import type { Message } from '@/features/chat/messages.types';

describe('suggestFollowUpsFromAssistantMessage', () => {
  it('returns generic suggestion ids for plain text', () => {
    const msg: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Here is an overview of the topic.' }],
      timestamp: 1,
    };
    const s = suggestFollowUpsFromAssistantMessage(msg);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s).toContain('generic_concrete_example');
  });

  it('biases toward code-oriented ids when code-like', () => {
    const msg: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Use `export function foo()` in your module.' }],
      timestamp: 1,
    };
    const s = suggestFollowUpsFromAssistantMessage(msg);
    expect(s).toContain('code_error_handling');
  });

  it('returns empty for non-assistant', () => {
    const msg: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'Hi' }],
      timestamp: 1,
    };
    expect(suggestFollowUpsFromAssistantMessage(msg)).toEqual([]);
  });
});
