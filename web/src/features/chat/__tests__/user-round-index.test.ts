import { describe, expect, it } from 'vitest';

import type { Message } from '@/features/chat/messages.types';
import {
  uiDeleteCountForUserRound,
  userRoundIndexFromUiMessageIndex,
} from '@/features/chat/user-round-index';

describe('userRoundIndexFromUiMessageIndex', () => {
  it('maps UI user row to 0-based user round', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'A' }] },
      { role: 'user-with-attachments', content: [{ type: 'text', text: 'b' }], attachments: [] },
    ];
    expect(userRoundIndexFromUiMessageIndex(messages, 0)).toBe(0);
    expect(userRoundIndexFromUiMessageIndex(messages, 2)).toBe(1);
    expect(userRoundIndexFromUiMessageIndex(messages, 1)).toBeNull();
  });
});

describe('uiDeleteCountForUserRound', () => {
  it('removes merged assistant bubble after user', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'A' }] },
    ];
    expect(uiDeleteCountForUserRound(messages, 0)).toBe(2);
  });
});
