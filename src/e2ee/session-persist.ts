import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildDirectionKeys, base64UrlToBytes, bytesToBase64Url } from '@xopcai/xopc-e2ee';

import { resolveStateDir } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';

import type { E2eeSession } from './session-store.js';

const log = createLogger('E2EE:SessionStore');

type PersistedE2eeSession = {
  sessionId: string;
  rootKey: string;
  reqSeq: number;
  resSeq: number;
  streamSeq: number;
  expiresAt: number;
};

function sessionsDir(): string {
  return join(resolveStateDir(), 'e2ee', 'sessions');
}

function sessionFilePath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(sessionsDir(), `${safe}.json`);
}

async function hydrateSession(record: PersistedE2eeSession): Promise<E2eeSession | null> {
  if (Date.now() > record.expiresAt) return null;
  try {
    const rootKey = base64UrlToBytes(record.rootKey);
    const keys = await buildDirectionKeys(rootKey);
    return {
      sessionId: record.sessionId,
      rootKey,
      requestKey: keys.requestKey,
      responseKey: keys.responseKey,
      streamKey: keys.streamKey,
      reqSeq: record.reqSeq,
      resSeq: record.resSeq,
      streamSeq: record.streamSeq,
      expiresAt: record.expiresAt,
    };
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    log.warn({ sessionId: record.sessionId, errorMessage: em }, 'Skipped corrupt E2EE session file');
    return null;
  }
}

export function persistE2eeSession(session: E2eeSession): void {
  try {
    mkdirSync(sessionsDir(), { recursive: true, mode: 0o700 });
    const payload: PersistedE2eeSession = {
      sessionId: session.sessionId,
      rootKey: bytesToBase64Url(session.rootKey),
      reqSeq: session.reqSeq,
      resSeq: session.resSeq,
      streamSeq: session.streamSeq,
      expiresAt: session.expiresAt,
    };
    writeFileSync(sessionFilePath(session.sessionId), JSON.stringify(payload, null, 2), {
      mode: 0o600,
    });
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    log.warn({ sessionId: session.sessionId, errorMessage: em }, 'E2EE session persist failed');
  }
}

export function deletePersistedE2eeSession(sessionId: string): void {
  try {
    unlinkSync(sessionFilePath(sessionId));
  } catch {
    /* missing file is fine */
  }
}

export async function loadPersistedE2eeSession(sessionId: string): Promise<E2eeSession | null> {
  try {
    const raw = readFileSync(sessionFilePath(sessionId), 'utf8');
    const record = JSON.parse(raw) as PersistedE2eeSession;
    if (record.sessionId !== sessionId) return null;
    const session = await hydrateSession(record);
    if (!session) deletePersistedE2eeSession(sessionId);
    return session;
  } catch {
    return null;
  }
}

export async function loadAllPersistedE2eeSessions(): Promise<E2eeSession[]> {
  let names: string[] = [];
  try {
    names = readdirSync(sessionsDir()).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }

  const loaded: E2eeSession[] = [];
  for (const name of names) {
    try {
      const raw = readFileSync(join(sessionsDir(), name), 'utf8');
      const record = JSON.parse(raw) as PersistedE2eeSession;
      const session = await hydrateSession(record);
      if (session) {
        loaded.push(session);
      } else {
        deletePersistedE2eeSession(record.sessionId);
      }
    } catch {
      /* skip corrupt files */
    }
  }
  return loaded;
}
