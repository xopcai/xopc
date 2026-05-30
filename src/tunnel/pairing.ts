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

export type PairingExchangePayload = {
  token: string;
  baseUrl: string | null;
  lanUrl: string | null;
  connectUrls: string[];
};

const EXCHANGE_REPLAY_MS = 60_000;
const exchangeReplayCache = new Map<string, { expiresAt: number; payload: PairingExchangePayload }>();

export function cachePairingExchange(secret: string, payload: PairingExchangePayload): void {
  exchangeReplayCache.set(secret, { expiresAt: Date.now() + EXCHANGE_REPLAY_MS, payload });
}

export function getCachedPairingExchange(secret: string): PairingExchangePayload | null {
  const entry = exchangeReplayCache.get(secret);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    exchangeReplayCache.delete(secret);
    return null;
  }
  return entry.payload;
}

const inflightExchanges = new Map<string, Promise<PairingExchangePayload | null>>();

/**
 * Consume a pairing secret once and build the exchange payload.
 * Concurrent requests for the same secret share one in-flight exchange (mobile cold-start deeplink).
 */
export async function exchangePairingSecretOnce(
  secret: string,
  buildPayload: () => PairingExchangePayload,
): Promise<PairingExchangePayload | null> {
  const key = secret.trim();
  if (!key) return null;

  const replay = getCachedPairingExchange(key);
  if (replay) return replay;

  let inflight = inflightExchanges.get(key);
  if (!inflight) {
    inflight = (async (): Promise<PairingExchangePayload | null> => {
      const cached = getCachedPairingExchange(key);
      if (cached) return cached;
      if (!consumePairingSecret(key)) {
        return getCachedPairingExchange(key);
      }
      const payload = buildPayload();
      cachePairingExchange(key, payload);
      return payload;
    })();
    inflightExchanges.set(key, inflight);
  }

  try {
    return await inflight;
  } finally {
    if (inflightExchanges.get(key) === inflight) inflightExchanges.delete(key);
  }
}

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
  exchangeReplayCache.clear();
  inflightExchanges.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
