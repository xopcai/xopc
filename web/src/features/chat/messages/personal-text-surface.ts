import type { Message } from './messages.types';

/** Personal text uses an immediate first paint inside the shared turn presentation. */
export function usesConversationText(message: Message, personal = false): boolean {
  return personal || message.textSurface === 'conversation';
}
