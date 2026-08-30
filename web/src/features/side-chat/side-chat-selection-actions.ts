import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';

export function addSelectionToMainChat(text: string): void {
  dispatchFillChatComposer(text);
}
