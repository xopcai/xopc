import { sessionWireToUiMessages } from '@/features/chat/messages/agent-messages';
import type { Message } from '@/features/chat/messages/messages.types';
import { extractUserMessagePlainText } from '@/features/chat/messages/user-message-plain-text';
import { isUiUserMessage } from '@/features/chat/messages/user-round-index';
import { normalizeWireAttachments } from '@/features/chat/messages/wire-attachments';

/** Parse `user_message` / `user_transcript` SSE payloads into a UI user row. */
export function userMessageFromSsePayload(parsed: Record<string, unknown>): Message | null {
  const timestamp =
    typeof parsed.timestamp === 'number' && Number.isFinite(parsed.timestamp)
      ? parsed.timestamp
      : Date.now();

  if (Array.isArray(parsed.content)) {
    const [msg] = sessionWireToUiMessages([
      {
        role: 'user',
        content: parsed.content,
        attachments: parsed.attachments,
        timestamp,
      },
    ]);
    return msg ?? null;
  }

  const text =
    typeof parsed.text === 'string'
      ? parsed.text
      : typeof parsed.content === 'string'
        ? parsed.content
        : '';
  if (!text.trim() && !parsed.attachments) {
    return null;
  }

  const attachments = normalizeWireAttachments(parsed.attachments);
  const role = attachments?.length ? 'user-with-attachments' : 'user';
  return {
    role,
    content: text.trim() ? [{ type: 'text', text: text.trim() }] : [],
    attachments,
    timestamp,
  };
}

export function userMessagesEquivalent(a: Message, b: Message): boolean {
  if (!isUiUserMessage(a.role) || !isUiUserMessage(b.role)) return false;
  if (a.timestamp === b.timestamp) return true;
  return extractUserMessagePlainText(a.content) === extractUserMessagePlainText(b.content);
}
