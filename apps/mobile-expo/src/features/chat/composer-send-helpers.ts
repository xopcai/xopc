import type { WireAttachment } from './composer.types';
import type { Message, MessageAttachment, MessageContent, TextContent } from './messages.types';
import { stripStartupContextForDisplay } from './wire-text-scrub';

const ENVELOPE_TIMESTAMP_RE = /^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}[^\]]*\]\s*/;

export function extractUserMessageText(content: MessageContent[]): string {
  return content
    .filter((b): b is TextContent => b.type === 'text')
    .map((b) => stripEnvelopeTimestampPrefix(stripStartupContextForDisplay(b.text)))
    .join('\n\n')
    .trim();
}

function stripEnvelopeTimestampPrefix(text: string): string {
  return text.replace(ENVELOPE_TIMESTAMP_RE, '');
}

export function messageAttachmentsToWire(attachments?: MessageAttachment[]): WireAttachment[] | undefined {
  if (!attachments?.length) return undefined;
  const wire = attachments
    .map((a) => ({
      type: a.type ?? 'document',
      mimeType: a.mimeType,
      data: a.data ?? a.content,
      uri: a.uri,
      name: a.name,
      size: a.size,
      workspaceRelativePath: a.workspaceRelativePath,
      durationSeconds: a.durationSeconds,
    }))
    .filter((a) => Boolean(a.data || a.uri || a.workspaceRelativePath));
  return wire.length ? wire : undefined;
}

export function findPrecedingUserMessage(messages: Message[], fromIndex: number): Message | null {
  for (let i = fromIndex - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user' || msg.role === 'user-with-attachments') return msg;
  }
  return null;
}

export function buildUserResendPayload(message: Message): { text: string; attachments?: WireAttachment[] } | null {
  const hasAudio = message.content.some((b) => b.type === 'audio');
  if (hasAudio) return null;
  const text = extractUserMessageText(message.content);
  const attachments = messageAttachmentsToWire(message.attachments);
  if (!text && !attachments?.length) return null;
  return { text, attachments };
}

export function isLastAssistantMessage(messages: Message[], index: number): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return i === index;
  }
  return false;
}

export function wireAttachmentsToMessageAttachments(wire: WireAttachment[]): MessageAttachment[] {
  return wire.map((w, index) => ({
    id: `pending-${index}-${Date.now()}`,
    name: w.name,
    type: w.type,
    mimeType: w.mimeType,
    size: w.size,
    content: w.data,
    data: w.data,
    uri: w.uri,
    preview: w.type === 'image' || w.mimeType?.startsWith('image/') ? w.data : undefined,
  }));
}

export function buildUserMessageContent(text: string, wire?: WireAttachment[]): MessageContent[] {
  const blocks: MessageContent[] = [];
  const trimmed = text.trim();
  if (trimmed) {
    blocks.push({ type: 'text', text: trimmed });
  }
  for (const att of wire ?? []) {
    const isImage = att.type === 'image' || att.mimeType?.startsWith('image/') === true;
    if (!isImage || !att.data) continue;
    const mime = att.mimeType || 'image/png';
    const payload = att.data.replace(/\s/g, '');
    blocks.push({
      type: 'image',
      source: {
        data: payload.startsWith('data:') ? payload : `data:${mime};base64,${payload}`,
        media_type: mime,
      },
    });
  }
  return blocks;
}

export function buildOptimisticUserMessage(text: string, wire?: WireAttachment[]): Message {
  const attachments = wire?.length ? wireAttachmentsToMessageAttachments(wire) : undefined;
  const content = buildUserMessageContent(text, wire);
  const hasAttachments = Boolean(attachments?.length);
  return {
    role: hasAttachments ? 'user-with-attachments' : 'user',
    content: content.length ? content : [{ type: 'text', text: text.trim() || '' }],
    attachments,
    timestamp: Date.now(),
  };
}

export function canSendComposerDraft(text: string, attachmentCount: number): boolean {
  return text.trim().length > 0 || attachmentCount > 0;
}
