import { sessionWireToUiMessages } from '@/features/chat/messages/agent-messages';
import type { Message } from '@/features/chat/messages/messages.types';
import { extractUserMessagePlainText } from '@/features/chat/messages/user-message-plain-text';
import { isUiUserMessage } from '@/features/chat/messages/user-round-index';
import { normalizeWireMedia } from '@/features/chat/messages/wire-attachments';
import { stripUserMessageForDisplay } from '@/features/chat/messages/wire-text-scrub';

/** Parse `user_message` / `user_transcript` SSE payloads into a UI user row. */
export function userMessageFromSsePayload(parsed: Record<string, unknown>): Message | null {
  const timestamp =
    typeof parsed.timestamp === 'number' && Number.isFinite(parsed.timestamp)
      ? parsed.timestamp
      : Date.now();

  if (Array.isArray(parsed.content) || typeof parsed.content === 'string') {
    const [msg] = sessionWireToUiMessages([
      {
        role: 'user',
        content: parsed.content,
        media: parsed.media,
        attachments: parsed.attachments,
        timestamp,
      },
    ]);
    return msg ?? null;
  }

  const text =
    typeof parsed.text === 'string' ? stripUserMessageForDisplay(parsed.text.trim()) : '';
  const media = normalizeWireMedia(parsed.media);
  if (!text && !media?.length) {
    return null;
  }

  return {
    role: 'user',
    content: text ? [{ type: 'text', text }] : [],
    attachments: media,
    timestamp,
  };
}

const OPTIMISTIC_USER_REPLACE_WINDOW_MS = 120_000;

/** True when the server row should replace the last optimistic user bubble from send(). */
export function shouldReplaceOptimisticUserRow(optimistic: Message, server: Message): boolean {
  if (!isUiUserMessage(optimistic.role) || !isUiUserMessage(server.role)) return false;

  const optText = extractUserMessagePlainText(optimistic.content).trim();
  const srvText = extractUserMessagePlainText(server.content).trim();
  const optAtt = optimistic.attachments?.length ?? 0;
  const srvAtt = server.attachments?.length ?? 0;
  const serverPreservesOptimisticAttachments = optAtt === 0 || srvAtt >= optAtt;

  if (
    serverPreservesOptimisticAttachments &&
    optText &&
    srvText &&
    (optText === srvText || srvText.startsWith(optText))
  ) {
    return true;
  }

  if (optAtt > 0 && serverPreservesOptimisticAttachments) {
    const tsDelta = Math.abs((server.timestamp ?? 0) - (optimistic.timestamp ?? 0));
    if (tsDelta <= OPTIMISTIC_USER_REPLACE_WINDOW_MS) {
      return true;
    }
  }

  return false;
}

export function userMessagesEquivalent(a: Message, b: Message): boolean {
  if (!isUiUserMessage(a.role) || !isUiUserMessage(b.role)) return false;
  if (a.timestamp === b.timestamp) return true;
  return extractUserMessagePlainText(a.content) === extractUserMessagePlainText(b.content);
}
