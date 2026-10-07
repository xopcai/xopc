import { describe, expect, it } from 'vitest';

import { assistantVisibleMessage } from '@/features/chat/messages/assistant-visible-message';
import type { Message } from '@/features/chat/messages/messages.types';

describe('assistantVisibleMessage', () => {
  it('removes a leaked silent marker from the beginning of a visible reply', () => {
    const message: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'NO_REPLY看你这笑法，是在测试我吗？' }],
    };
    expect(assistantVisibleMessage(message).content).toEqual([
      { type: 'text', text: '看你这笑法，是在测试我吗？' },
    ]);
    expect(message.content?.[0]).toEqual({ type: 'text', text: 'NO_REPLY看你这笑法，是在测试我吗？' });
  });

  it('removes a silent continuation before the actual reply', () => {
    const message: Message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'NO_REPLY' },
        { type: 'text', text: '还是会认真搭理你。' },
      ],
    };
    expect(assistantVisibleMessage(message).content).toEqual([
      { type: 'text', text: '还是会认真搭理你。' },
    ]);
  });

  it('preserves ordinary replies and the exact silent marker', () => {
    const reply: Message = { role: 'assistant', content: [{ type: 'text', text: '你好' }] };
    const silent: Message = { role: 'assistant', content: [{ type: 'text', text: 'NO_REPLY' }] };
    expect(assistantVisibleMessage(reply)).toBe(reply);
    expect(assistantVisibleMessage(silent)).toBe(silent);
  });
});
