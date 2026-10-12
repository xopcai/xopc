import type { Message } from './messages.types';

/** Build-time rollback keeps the legacy work-log presentation without changing transcripts. */
export function usesConversationText(message: Message, personal = false): boolean {
  return import.meta.env.VITE_PERSONAL_PROGRESSIVE_RESPONSE !== 'false'
    && (personal || message.textSurface === 'conversation');
}
