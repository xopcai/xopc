import { describe, expect, it } from 'vitest';

import {
  followUpPromptForSuggestionId,
  suggestFollowUpsFromAssistantMessage,
} from '@/features/chat/follow-up-suggestions';
import type { Message } from '@/features/chat/messages.types';

describe('suggestFollowUpsFromAssistantMessage', () => {
  it('returns generic suggestion ids for plain text', () => {
    const msg: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Here is an overview of the topic with enough length to matter.' }],
      timestamp: 1,
    };
    const s = suggestFollowUpsFromAssistantMessage(msg);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s).toContain('generic_concrete_example');
    expect(s).toContain('what_next');
  });

  it('biases toward code-oriented ids when code-like', () => {
    const msg: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Use `export function foo()` in your module.' }],
      timestamp: 1,
    };
    const s = suggestFollowUpsFromAssistantMessage(msg);
    expect(s).toContain('code_error_handling');
    expect(s).toContain('what_next');
  });

  it('includes web chips when URLs or references appear alongside code', () => {
    const msg: Message = {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text:
            'See https://example.com/doc for the API. ```ts\nexport async function fetch() {}\n```',
        },
      ],
      timestamp: 1,
    };
    const s = suggestFollowUpsFromAssistantMessage(msg);
    expect(s.some((id) => id.startsWith('code_'))).toBe(true);
    expect(s).toContain('web_more_details');
  });

  it('includes email chips for common letter patterns', () => {
    const msg: Message = {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text:
            'Dear team,\n\nHere is the update.\n\nBest regards,\nAlex\n\n' +
            'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor.',
        },
      ],
      timestamp: 1,
    };
    const s = suggestFollowUpsFromAssistantMessage(msg);
    expect(s).toContain('email_make_formal');
    expect(s).toContain('email_shorten');
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

describe('followUpPromptForSuggestionId', () => {
  it('returns English prompts for every suggestion id', () => {
    const ids = suggestFollowUpsFromAssistantMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'x'.repeat(120) }],
      timestamp: 1,
    });
    for (const id of ids) {
      const p = followUpPromptForSuggestionId(id);
      expect(p.length).toBeGreaterThan(10);
      expect(p).toMatch(/[a-z]/i);
    }
  });
});
