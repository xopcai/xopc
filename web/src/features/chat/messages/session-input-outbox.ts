type SubmissionOutboxEntry = {
  clientMessageId: string;
  fingerprint: string;
};

function key(sessionKey: string): string {
  return `xopc:submission:${sessionKey}`;
}

export function claimSubmissionId(sessionKey: string, fingerprint: string): string {
  try {
    const raw = sessionStorage.getItem(key(sessionKey));
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
    sessionStorage.setItem(key(sessionKey), JSON.stringify({ clientMessageId, fingerprint }));
  } catch {
    /* in-memory retry still uses the same id */
  }
  return clientMessageId;
}

export function completeSubmission(sessionKey: string, clientMessageId: string): void {
  try {
    const raw = sessionStorage.getItem(key(sessionKey));
    if (!raw) return;
    const entry = JSON.parse(raw) as Partial<SubmissionOutboxEntry>;
    if (entry.clientMessageId === clientMessageId) sessionStorage.removeItem(key(sessionKey));
  } catch {
    /* ignore unavailable storage */
  }
}
