import type { WireAttachment } from '@/features/chat/composer/composer.types';

/** Fired to set the main chat composer text (e.g. after Ctrl+K picking a command). */
export const FILL_CHAT_COMPOSER_EVENT = 'fill-chat-composer';

export type FillChatComposerDetail = {
  text: string;
  attachments?: WireAttachment[];
};

export function dispatchFillChatComposer(text: string, attachments?: WireAttachment[]): void {
  window.dispatchEvent(
    new CustomEvent<FillChatComposerDetail>(FILL_CHAT_COMPOSER_EVENT, {
      detail: { text, attachments },
    }),
  );
}
