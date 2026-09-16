type SubmissionOutboxEntry = {
  clientMessageId: string;
  fingerprint: string;
};

function key(conversationId: string): string {
  return `xopc:submission:${conversationId}`;
}

export function claimSubmissionId(conversationId: string, fingerprint: string): string {
  try {
    const raw = sessionStorage.getItem(key(conversationId));
    if (raw) {
      const entry = JSON.parse(raw) as Partial<SubmissionOutboxEntry>;
      if (entry.fingerprint === fingerprint && typeof entry.clientMessageId === 'string') {
        return entry.clientMessageId;
      }
    }
  } catch {
    /* replace an unreadable entry */
  }
  const clientMessageId = crypto.randomUUID();
  try {
    sessionStorage.setItem(key(conversationId), JSON.stringify({ clientMessageId, fingerprint }));
  } catch {
    /* in-memory retry still uses the same id */
  }
  return clientMessageId;
}

export function completeSubmission(conversationId: string, clientMessageId: string): void {
  try {
    const raw = sessionStorage.getItem(key(conversationId));
    if (!raw) return;
    const entry = JSON.parse(raw) as Partial<SubmissionOutboxEntry>;
    if (entry.clientMessageId === clientMessageId) sessionStorage.removeItem(key(conversationId));
  } catch {
    /* ignore unavailable storage */
  }
}
