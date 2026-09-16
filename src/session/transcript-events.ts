import { normalizeOptionalString } from '../utils/string-coerce.js';

export type SessionTranscriptUpdate = {
  conversationId?: string;
  message?: unknown;
  messageId?: string;
};

type SessionTranscriptListener = (update: SessionTranscriptUpdate) => void;

const SESSION_TRANSCRIPT_LISTENERS = new Set<SessionTranscriptListener>();

export function onSessionTranscriptUpdate(listener: SessionTranscriptListener): () => void {
  SESSION_TRANSCRIPT_LISTENERS.add(listener);
  return () => {
    SESSION_TRANSCRIPT_LISTENERS.delete(listener);
  };
}

export function emitSessionTranscriptUpdate(update: SessionTranscriptUpdate): void {
  const conversationId = normalizeOptionalString(update.conversationId);
  if (!conversationId) {
    return;
  }
  const nextUpdate: SessionTranscriptUpdate = {
    ...(conversationId ? { conversationId } : {}),
    ...(update.message !== undefined ? { message: update.message } : {}),
    ...(normalizeOptionalString(update.messageId)
      ? { messageId: normalizeOptionalString(update.messageId) }
      : {}),
  };
  for (const listener of SESSION_TRANSCRIPT_LISTENERS) {
    try {
      listener(nextUpdate);
    } catch {
      /* ignore */
    }
  }
}
