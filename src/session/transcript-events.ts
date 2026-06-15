import { normalizeOptionalString } from '../utils/string-coerce.js';

export type SessionTranscriptUpdate = {
  /** @deprecated File path no longer used after SQLite Phase 4. */
  sessionFile?: string;
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

export function emitSessionTranscriptUpdate(update: string | SessionTranscriptUpdate): void {
  const normalized =
    typeof update === 'string'
      ? { sessionFile: update }
      : {
          sessionFile: update.sessionFile,
          sessionKey: update.sessionKey,
          message: update.message,
          messageId: update.messageId,
        };
  const sessionKey = normalizeOptionalString(normalized.sessionKey);
  const sessionFile = normalizeOptionalString(normalized.sessionFile);
  if (!sessionKey && !sessionFile) {
    return;
  }
  const nextUpdate: SessionTranscriptUpdate = {
    ...(sessionFile ? { sessionFile } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(normalized.message !== undefined ? { message: normalized.message } : {}),
    ...(normalizeOptionalString(normalized.messageId)
      ? { messageId: normalizeOptionalString(normalized.messageId) }
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
