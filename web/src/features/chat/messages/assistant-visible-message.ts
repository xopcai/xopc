import type { Message } from '@/features/chat/messages/messages.types';

const SILENT_REPLY_MARKER = 'NO_REPLY';

export function assistantVisibleMessage(message: Message, options?: { hideSilentReply?: boolean; streaming?: boolean }): Message {
  if (message.role !== 'assistant' || !message.content?.length) return message;

  if (options?.hideSilentReply) {
    const lastText = options.streaming ? message.content.findLast(block => block.type === 'text') : undefined;
    const content = message.content.filter(block => {
      if (block.type !== 'text') return true;
      const text = block.text.trim();
      if (text === SILENT_REPLY_MARKER) return false;
      return !(block === lastText && block.presentation === 'pending' && text && SILENT_REPLY_MARKER.startsWith(text));
    });
    if (content.length !== message.content.length) return assistantVisibleMessage({ ...message, content }, options);
  }

  const firstTextIndex = message.content.findIndex((block) => block.type === 'text');
  if (firstTextIndex < 0) return message;
  const block = message.content[firstTextIndex];
  if (block.type !== 'text') return message;

  const text = block.text.trimStart();
  if (options?.hideSilentReply && (text === SILENT_REPLY_MARKER
    || (options.streaming && text.length > 0 && SILENT_REPLY_MARKER.startsWith(text)))) {
    return { ...message, content: message.content.filter((_, index) => index !== firstTextIndex) };
  }
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
