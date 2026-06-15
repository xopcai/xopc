import { normalizeOptionalString } from '../utils/string-coerce.js';

export type SessionTranscriptUpdate = {
  sessionKey?: string;
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
  const sessionKey = normalizeOptionalString(update.sessionKey);
  if (!sessionKey) {
    return;
  }
  const nextUpdate: SessionTranscriptUpdate = {
    ...(sessionKey ? { sessionKey } : {}),
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
