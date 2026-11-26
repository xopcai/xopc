import { isXopcDatabaseOpen } from '../../storage/sqlite/connection.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ExternalSessionPool');

const DEFAULT_IDLE_TTL_MS = 10 * 60_000;

export type PooledExternalSessionEntry<T> = {
  fingerprint: string;
  resource: T;
  isAlive: () => boolean;
  dispose: (force?: boolean) => Promise<void>;
};

type StoredPoolEntry = PooledExternalSessionEntry<unknown> & {
  busy: boolean;
  dbRef: unknown;
  idleTimer?: NodeJS.Timeout;
};

const pool = new Map<string, StoredPoolEntry>();

function currentDbIdentity(): unknown {
  return isXopcDatabaseOpen() ? getSqliteDatabase() : null;
}

function clearIdleTimer(entry: StoredPoolEntry): void {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }
}

/**
 * Attempt to check out a warm external runtime process for `conversationId`.
 * Returns `undefined` on cache miss, config fingerprint mismatch, dead process, or DB reopen.
 */
export async function checkoutPooledExternalSession<T>(
  conversationId: string,
  fingerprint: string,
): Promise<T | undefined> {
  const existing = pool.get(conversationId);
  if (!existing) return undefined;
  if (existing.busy) return undefined;

  const dbRef = currentDbIdentity();
  if (existing.fingerprint === fingerprint && existing.dbRef === dbRef && existing.isAlive()) {
    clearIdleTimer(existing);
    existing.busy = true;
    return existing.resource as T;
  }

  // Fingerprint changed, database reopened, or process exited: dispose stale resource before cold-starting.
  await disposePooledExternalSession(conversationId, true);
  return undefined;
}

/**
 * Return a healthy external runtime process to the idle pool for fast reuse on subsequent turns.
 */
export function checkinPooledExternalSession<T>(
  conversationId: string,
  entry: PooledExternalSessionEntry<T>,
  idleTtlMs = DEFAULT_IDLE_TTL_MS,
): void {
  const previous = pool.get(conversationId);
  if (previous && previous.resource !== entry.resource) {
    clearIdleTimer(previous);
    void previous.dispose(true).catch(() => {});
  }

  if (!entry.isAlive()) {
    pool.delete(conversationId);
    void entry.dispose(true).catch(() => {});
    return;
  }

  const stored: StoredPoolEntry = {
    ...(entry as PooledExternalSessionEntry<unknown>),
    busy: false,
    dbRef: currentDbIdentity(),
  };
  stored.idleTimer = setTimeout(() => {
    const latest = pool.get(conversationId);
    if (latest !== stored || latest.busy) return;
    pool.delete(conversationId);
    void stored.dispose(false).catch((error) => {
      log.debug({ err: error, conversationId }, 'Idle external runtime session dispose failed');
    });
  }, idleTtlMs);
  stored.idleTimer.unref();
  pool.set(conversationId, stored);
}

/** Close and evict any pooled external runtime process for `conversationId`. */
export async function disposePooledExternalSession(conversationId: string, force = false): Promise<void> {
  const existing = pool.get(conversationId);
  if (!existing) return;
  pool.delete(conversationId);
  clearIdleTimer(existing);
  await existing.dispose(force).catch(() => {});
}

/** Close and evict every pooled external runtime process (used on shutdown). */
export async function disposeAllPooledExternalSessions(force = false): Promise<void> {
  const ids = [...pool.keys()];
  await Promise.all(ids.map((id) => disposePooledExternalSession(id, force)));
}

export function getPooledExternalSessionCount(): number {
  return pool.size;
}
