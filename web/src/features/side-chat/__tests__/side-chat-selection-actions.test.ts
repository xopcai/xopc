// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  FILL_CHAT_COMPOSER_EVENT,
  type FillChatComposerDetail,
} from '@/features/chat/composer/fill-composer-dispatch';
import { addSelectionToMainChat } from '../side-chat-selection-launcher';

describe('side chat selection actions', () => {
  it('adds selected text to the main chat composer', () => {
    const listener = vi.fn();
    window.addEventListener(FILL_CHAT_COMPOSER_EVENT, listener);

    addSelectionToMainChat('selected text');

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0]?.[0] as CustomEvent<FillChatComposerDetail>).detail).toEqual({
      text: 'selected text',
    });
    window.removeEventListener(FILL_CHAT_COMPOSER_EVENT, listener);
  });
});
