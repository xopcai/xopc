/** Fired to set the main chat composer text (e.g. after Ctrl+K picking a command). */
export const FILL_CHAT_COMPOSER_EVENT = 'fill-chat-composer';

export type FillChatComposerDetail = {
  text: string;
};

export function dispatchFillChatComposer(text: string): void {
  window.dispatchEvent(
    new CustomEvent<FillChatComposerDetail>(FILL_CHAT_COMPOSER_EVENT, {
      detail: { text },
    }),
  );
}
