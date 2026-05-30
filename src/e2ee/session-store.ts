import { buildDirectionKeys, deriveSessionRootKey, hmacSha256 } from '@xopcai/xopc-e2ee';

import { getGatewayE2eeIdentity } from './identity.js';
import {
  deletePersistedE2eeSession,
  loadAllPersistedE2eeSessions,
  loadPersistedE2eeSession,
  persistE2eeSession,
} from './session-persist.js';

export type E2eeSession = {
  sessionId: string;
  rootKey: Uint8Array;
  requestKey: CryptoKey;
  responseKey: CryptoKey;
  streamKey: CryptoKey;
  reqSeq: number;
  resSeq: number;
  streamSeq: number;
  expiresAt: number;
};

const SESSION_TTL_MS = 24 * 60 * 60_000;
const sessions = new Map<string, E2eeSession>();
let hydratePromise: Promise<void> | null = null;

async function ensureHydrated(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const restored = await loadAllPersistedE2eeSessions();
      for (const session of restored) {
        sessions.set(session.sessionId, session);
      }
    })();
  }
  await hydratePromise;
}

export async function createE2eeSession(params: {
  sessionId: string;
  devicePublicKey: Uint8Array;
  pairingSecret?: string;
}): Promise<{ session: E2eeSession; serverConfirm: string }> {
  await ensureHydrated();
  const identity = await getGatewayE2eeIdentity();
  const rootKey = await deriveSessionRootKey({
    privateKey: identity.privateKey,
    peerPublicKey: params.devicePublicKey,
    sessionId: params.sessionId,
    pairingSecret: params.pairingSecret,
  });
  const keys = await buildDirectionKeys(rootKey);
  const session: E2eeSession = {
    sessionId: params.sessionId,
    rootKey,
    requestKey: keys.requestKey,
    responseKey: keys.responseKey,
    streamKey: keys.streamKey,
    reqSeq: 0,
    resSeq: 0,
    streamSeq: 0,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(params.sessionId, session);
  persistE2eeSession(session);
  const serverConfirm = await hmacSha256(rootKey, 'xopc-e2ee-server-confirm');
  return { session, serverConfirm };
}

export function getE2eeSession(sessionId: string): E2eeSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    deletePersistedE2eeSession(sessionId);
    return null;
  }
  return session;
}

/** Load persisted sessions from disk (idempotent). */
export async function ensureE2eeSessionsLoaded(): Promise<void> {
  await ensureHydrated();
}

export async function getE2eeSessionAsync(sessionId: string): Promise<E2eeSession | null> {
  await ensureHydrated();
  const cached = getE2eeSession(sessionId);
  if (cached) return cached;
  const loaded = await loadPersistedE2eeSession(sessionId);
  if (loaded) sessions.set(sessionId, loaded);
  return loaded;
}

export function consumeRequestSeq(sessionId: string, seq: number): E2eeSession | null {
  const session = getE2eeSession(sessionId);
  if (!session) return null;
  if (!Number.isFinite(seq) || seq < 1) return null;
  if (seq < session.reqSeq) return null;
  if (seq > session.reqSeq + 1) return null;
  if (seq > session.reqSeq) {
    session.reqSeq = seq;
    persistE2eeSession(session);
  }
  return session;
}

export function nextResponseSeq(session: E2eeSession): number {
  session.resSeq += 1;
  persistE2eeSession(session);
  return session.resSeq;
}

export function nextStreamSeq(session: E2eeSession): number {
  session.streamSeq += 1;
  if (session.streamSeq % 32 === 0) persistE2eeSession(session);
  return session.streamSeq;
}

/** Persist stream cursor after a relay-stream closes. */
export function finalizeE2eeStreamSession(session: E2eeSession): void {
  persistE2eeSession(session);
}

/** @internal */
export function resetE2eeSessionsForTests(): void {
  sessions.clear();
  hydratePromise = null;
}
