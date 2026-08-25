const COMPOSER_ATTACHMENT_HANDOFF_TTL_MS = 2 * 60 * 1000;

type ComposerAttachmentHandoff = {
  file: File | null;
  name: string;
  type: string;
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
  handoffs.set(id, {
    file,
    name: file.name,
    type: file.type,
    expiresAt: now + COMPOSER_ATTACHMENT_HANDOFF_TTL_MS,
  });
  return id;
}

/** Reads pending file metadata without consuming the handoff. */
export function peekComposerAttachmentHandoff(
  id: string,
  now = Date.now(),
): Pick<File, 'name' | 'type'> | null {
  const handoff = handoffs.get(id);
  if (!handoff) return null;
  if (handoff.expiresAt <= now) {
    handoffs.delete(id);
    return null;
  }
  return { name: handoff.name, type: handoff.type };
}

/** Atomically consumes a pending file snapshot. Expired and unknown ids return null. */
export function takeComposerAttachmentHandoff(id: string, now = Date.now()): File | null {
  const handoff = handoffs.get(id);
  if (!handoff) return null;
  if (handoff.expiresAt <= now) {
    handoffs.delete(id);
    return null;
  }
  if (!handoff.file) return null;
  const file = handoff.file;
  handoff.file = null;
  return file;
}

export function resetComposerAttachmentHandoffsForTests(): void {
  handoffs.clear();
}
