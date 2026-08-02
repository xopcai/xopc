const COMPOSER_ATTACHMENT_HANDOFF_TTL_MS = 2 * 60 * 1000;

type ComposerAttachmentHandoff = {
  file: File;
  expiresAt: number;
};

const handoffs = new Map<string, ComposerAttachmentHandoff>();

function createHandoffId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function removeExpiredHandoffs(now: number): void {
  for (const [id, handoff] of handoffs) {
    if (handoff.expiresAt <= now) handoffs.delete(id);
  }
}

/** Stores a browser-local file snapshot for one new-chat navigation. */
export function createComposerAttachmentHandoff(file: File, now = Date.now()): string {
  removeExpiredHandoffs(now);
  const id = createHandoffId();
  handoffs.set(id, { file, expiresAt: now + COMPOSER_ATTACHMENT_HANDOFF_TTL_MS });
  return id;
}

/** Atomically consumes a pending file snapshot. Expired and unknown ids return null. */
export function takeComposerAttachmentHandoff(id: string, now = Date.now()): File | null {
  const handoff = handoffs.get(id);
  handoffs.delete(id);
  if (!handoff || handoff.expiresAt <= now) return null;
  return handoff.file;
}

export function resetComposerAttachmentHandoffsForTests(): void {
  handoffs.clear();
}
