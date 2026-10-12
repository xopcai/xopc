import type { Message } from './messages.types';

/** The personal surface renders narration inline without changing transcripts. */
export function usesConversationText(message: Message, personal = false): boolean {
  return personal || message.textSurface === 'conversation';
}
