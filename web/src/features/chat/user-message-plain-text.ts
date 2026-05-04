import type { WireAttachment } from '@/features/chat/composer.types';
import type { Message, MessageAttachment, MessageContent } from '@/features/chat/messages.types';

export function stripEnvelopeTimestampPrefix(text: string): string {
  return text.replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\]\s+/, '');
}

export function extractUserMessagePlainText(content: MessageContent[] | undefined): string {
  return (content ?? [])
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && Boolean(b.text))
    .map((b) => stripEnvelopeTimestampPrefix(b.text))
    .join('\n\n')
    .trim();
}

export function isLastUserMessageInThread(messages: Message[], index: number): boolean {
  const msg = messages[index];
  if (!msg) return false;
  if (msg.role !== 'user' && msg.role !== 'user-with-attachments') return false;
  for (let j = index + 1; j < messages.length; j++) {
    const r = messages[j].role;
    if (r === 'user' || r === 'user-with-attachments') return false;
  }
  return true;
}

export function messageAttachmentsToWire(
  attachments?: MessageAttachment[],
): WireAttachment[] | undefined {
  if (!attachments?.length) return undefined;
  return attachments.map((a) => ({
    type: a.type ?? 'document',
    mimeType: a.mimeType,
    data: a.data ?? a.content,
    name: a.name,
    size: a.size,
    workspaceRelativePath: a.workspaceRelativePath,
    durationSeconds: a.durationSeconds,
  }));
}
