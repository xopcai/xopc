import type { Message } from '@/features/chat/messages/messages.types';

export const SIDE_CHAT_DRAFT_BYTES = 256 * 1024;
export const SIDE_CHAT_READING_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();

export type SideChatReading = { messages: Message[]; truncated: boolean; bytes: number };

export function textBytes(text: string): number {
  return encoder.encode(text).byteLength;
}

export function limitSideChatDraft(text: string): string {
  if (textBytes(text) <= SIDE_CHAT_DRAFT_BYTES) return text;
  return new TextDecoder().decode(encoder.encode(text).subarray(0, SIDE_CHAT_DRAFT_BYTES), { stream: true });
}

/** A page-local reading copy never retains tools, attachments, or parent context. */
export function buildSideChatReading(messages: Message[]): SideChatReading {
  let remaining = 512 * 1024;
  let truncated = messages.length > 20;
  const kept: Message[] = [];
  for (const message of messages.slice(-20).reverse()) {
    const text = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
    if (message.content.some((block) => block.type !== 'text') || message.attachments?.length) truncated = true;
    if (!text) continue;
    // Keep metadata bounded too, and reserve space for JSON structure.
    if (remaining <= 256) { truncated = true; continue; }
    const encoded = encoder.encode(text);
    const body = encoded.byteLength + 256 > remaining
      ? new TextDecoder().decode(encoded.subarray(0, remaining - 256), { stream: true })
      : text;
    if (body !== text) truncated = true;
    const bytes = textBytes(body) + 256;
    remaining -= bytes;
    kept.unshift({ role: message.role, content: [{ type: 'text', text: body }], timestamp: message.timestamp, renderKey: message.renderKey?.slice(0, 128) });
  }
  return { messages: kept, truncated, bytes: 512 * 1024 - remaining };
}
