import { randomBytes } from 'node:crypto';

import { createLogger } from '../utils/logger.js';

const log = createLogger('TunnelPairing');

const PAIRING_TTL_MS = 5 * 60_000;
const CLEANUP_INTERVAL_MS = 60_000;

type PairingSession = {
  expiresAt: Date;
  consumed: boolean;
};

const sessions = new Map<string, PairingSession>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, session] of sessions) {
      if (now > session.expiresAt.getTime()) sessions.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

export type PairingSecretResult = {
  secret: string;
  expiresAt: Date;
};

export function createPairingSecret(): PairingSecretResult {
  ensureCleanupTimer();
  const secret = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  sessions.set(secret, { expiresAt, consumed: false });
  log.info({ expiresAt: expiresAt.toISOString() }, 'Pairing session created');
  return { secret, expiresAt };
}

export function consumePairingSecret(secret: string): boolean {
  if (!secret.trim()) return false;
  const session = sessions.get(secret);
  if (!session) return false;
  if (session.consumed) return false;
  if (Date.now() > session.expiresAt.getTime()) {
    sessions.delete(secret);
    return false;
  }
  session.consumed = true;
  sessions.delete(secret);
  log.info('Pairing session consumed');
  return true;
}

/** @internal */
export function resetPairingSessionsForTests(): void {
  sessions.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
