import type { WireAttachment } from '@/features/chat/composer/composer.types';

const COMPOSER_PAYLOAD_HANDOFF_TTL_MS = 2 * 60 * 1000;

type ComposerPayloadHandoff = {
  attachments: WireAttachment[] | null;
  expiresAt: number;
};

const handoffs = new Map<string, ComposerPayloadHandoff>();

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

/** Stores already-processed attachments for an immediate send after new-chat navigation. */
export function createComposerPayloadHandoff(
  attachments: WireAttachment[],
  now = Date.now(),
): string {
  removeExpiredHandoffs(now);
  const id = createHandoffId();
  handoffs.set(id, {
    attachments: attachments.map((attachment) => ({ ...attachment })),
    expiresAt: now + COMPOSER_PAYLOAD_HANDOFF_TTL_MS,
  });
  return id;
}

/** Atomically consumes staged attachments. Expired and unknown ids return null. */
export function takeComposerPayloadHandoff(
  id: string,
  now = Date.now(),
): WireAttachment[] | null {
  const handoff = handoffs.get(id);
  if (!handoff) return null;
  if (handoff.expiresAt <= now) {
    handoffs.delete(id);
    return null;
  }
  if (!handoff.attachments) return null;
  const attachments = handoff.attachments;
  handoff.attachments = null;
  return attachments;
}

export function resetComposerPayloadHandoffsForTests(): void {
  handoffs.clear();
}
