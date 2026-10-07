import type { Message } from '@/features/chat/messages/messages.types';

const SILENT_REPLY_MARKER = 'NO_REPLY';

export function assistantVisibleMessage(message: Message): Message {
  if (message.role !== 'assistant' || !message.content?.length) return message;

  const firstTextIndex = message.content.findIndex((block) => block.type === 'text');
  if (firstTextIndex < 0) return message;
  const block = message.content[firstTextIndex];
  if (block.type !== 'text') return message;

  const text = block.text.trimStart();
  if (!text.startsWith(SILENT_REPLY_MARKER)) return message;
  if (text.length === SILENT_REPLY_MARKER.length) {
    const laterReply = message.content.slice(firstTextIndex + 1).some(
      (item) => item.type === 'text' && item.text.trim().length > 0,
    );
    if (!laterReply) return message;
    return {
      ...message,
      content: message.content.filter((_, index) => index !== firstTextIndex),
    };
  }
  const visibleText = text.slice(SILENT_REPLY_MARKER.length).trimStart();
  if (!visibleText) return message;

  const content = [...message.content];
  content[firstTextIndex] = { ...block, text: visibleText };
  return { ...message, content };
}
