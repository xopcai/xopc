import type { Message, MessageContent } from './messages.types';
import { stripUserMessageForDisplay } from './wire-text-scrub';

export function applyStripToUserContent(
  role: Message['role'],
  blocks: MessageContent[],
): MessageContent[] {
  if (role !== 'user' && role !== 'user-with-attachments') return blocks;
  const mapped = blocks.map((b) => {
    if (b.type === 'text' && typeof b.text === 'string') {
      return { ...b, text: stripUserMessageForDisplay(b.text) };
    }
    return b;
  });
  return mapped.filter((b) => {
    if (b.type === 'text' && (!b.text || !b.text.trim())) return false;
    return true;
  });
}
