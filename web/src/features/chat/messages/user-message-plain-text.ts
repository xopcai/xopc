import type { WireAttachment } from '@/features/chat/composer/composer.types';
import type { Message, MessageAttachment, MessageContent } from '@/features/chat/messages/messages.types';
import { stripUserMessageForDisplay } from '@/features/chat/messages/wire-text-scrub';

export function stripEnvelopeTimestampPrefix(text: string): string {
  return text.replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\]\s+/, '');
}

export function extractUserMessagePlainText(content: MessageContent[] | undefined): string {
  return (content ?? [])
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && Boolean(b.text))
    .map((b) => stripUserMessageForDisplay(stripEnvelopeTimestampPrefix(b.text)))
    .join('\n\n')
    .trim();
}

export function isLastUserMessageInThread(messages: Message[], index: number): boolean {
  const msg = messages[index];
  if (!msg) return false;
  if (msg.role !== 'user') return false;
  for (let j = index + 1; j < messages.length; j++) {
    const r = messages[j].role;
    if (r === 'user') return false;
  }
  return true;
}

export function messageAttachmentsToWire(
  attachments?: MessageAttachment[],
): WireAttachment[] | undefined {
  if (!attachments?.length) return undefined;
  return attachments.map((a) => {
    const data = a.data ?? a.content;
    return {
      id: a.id,
      type: a.type ?? (a.mimeType?.startsWith('image/') ? 'image' : 'document'),
      mimeType: a.mimeType,
      ...(data ? { data } : {}),
      name: a.name,
      size: a.size,
      ...(a.uri ? { uri: a.uri } : {}),
      ...(a.bucket ? { bucket: a.bucket } : {}),
      ...(a.path ? { path: a.path } : {}),
      durationSeconds: a.durationSeconds,
    };
  });
}
