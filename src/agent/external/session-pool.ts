import { realpathSync, statSync } from 'node:fs';

import { isXopcDatabaseOpen } from '../../storage/sqlite/connection.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ExternalSessionPool');

const DEFAULT_IDLE_TTL_MS = 10 * 60_000;

type BinaryStamp = { realPath: string; mtimeMs: number };

function readBinaryStamp(executablePath?: string): BinaryStamp | undefined {
  if (!executablePath) return undefined;
  try {
    const realPath = realpathSync(executablePath);
    const stat = statSync(realPath);
    return { realPath, mtimeMs: stat.mtimeMs };
  } catch {
    return undefined;
  }
}

export type PooledExternalSessionEntry<T> = {
  fingerprint: string;
  resource: T;
  /** Optional native runtime session/thread id for cross-conversation lock tracking. */
  nativeSessionId?: string;
  /** Optional host CLI binary path; if replaced/upgraded on disk, the pooled process is evicted. */
  executablePath?: string;
  isAlive: () => boolean;
  dispose: (force?: boolean) => Promise<void>;
};

type StoredPoolEntry = PooledExternalSessionEntry<unknown> & {
  busy: boolean;
  dbRef: unknown;
  binaryStamp?: BinaryStamp;
  idleTimer?: NodeJS.Timeout;
};

const pool = new Map<string, StoredPoolEntry>();
const inFlightByConversation = new Map<string, Set<Promise<void>>>();
const inFlightByNativeId = new Map<string, Set<Promise<void>>>();

function currentDbIdentity(): unknown {
  return isXopcDatabaseOpen() ? getSqliteDatabase() : null;
}

function clearIdleTimer(entry: StoredPoolEntry): void {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }
}

function trackInFlight(
  map: Map<string, Set<Promise<void>>>,
  key: string | undefined,
  promise: Promise<void>,
): void {
  if (!key) return;
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(promise);
  void promise.finally(() => {
    set?.delete(promise);
    if (set?.size === 0) map.delete(key);
  });
}

async function awaitInFlight(
  map: Map<string, Set<Promise<void>>>,
  key: string | undefined,
): Promise<void> {
  if (!key) return;
  while (true) {
    const pending = map.get(key);
    if (!pending || pending.size === 0) return;
    await Promise.allSettled([...pending]);
  }
}

function startTrackedDisposal(
  conversationId: string,
  entry: Pick<StoredPoolEntry, 'dispose' | 'nativeSessionId'>,
  force: boolean,
  logFailureMsg?: string,
): Promise<void> {
  const disposal = Promise.resolve()
    .then(() => entry.dispose(force))
    .catch((error) => {
      if (logFailureMsg) {
        log.debug({ err: error, conversationId, nativeSessionId: entry.nativeSessionId }, logFailureMsg);
      }
    });
  trackInFlight(inFlightByConversation, conversationId, disposal);
  trackInFlight(inFlightByNativeId, entry.nativeSessionId, disposal);
  return disposal;
}

/**
 * Attempt to check out a warm external runtime process for `conversationId`.
 * Waits for any in-flight disposal of the same conversation or native session before returning,
 * preventing a newly spawned process from racing a shutting-down writer process.
 * Returns `undefined` on cache miss, config fingerprint mismatch, dead process, or DB reopen.
 */
export async function checkoutPooledExternalSession<T>(
  conversationId: string,
  fingerprint: string,
  options?: { nativeSessionId?: string },
): Promise<T | undefined> {
  await Promise.all([
    awaitInFlight(inFlightByConversation, conversationId),
    awaitInFlight(inFlightByNativeId, options?.nativeSessionId),
  ]);

  const existing = pool.get(conversationId);
  if (!existing) {
    if (options?.nativeSessionId) {
      await disposePooledExternalSessionsByNativeId(options.nativeSessionId, true);
    }
    return undefined;
  }
  if (existing.busy) return undefined;

  const dbRef = currentDbIdentity();
  const binaryUnchanged = !existing.binaryStamp || (() => {
    const latest = readBinaryStamp(existing.executablePath);
    return Boolean(
      latest
      && latest.realPath === existing.binaryStamp.realPath
      && latest.mtimeMs === existing.binaryStamp.mtimeMs,
    );
  })();
  if (existing.fingerprint === fingerprint && existing.dbRef === dbRef && binaryUnchanged && existing.isAlive()) {
    clearIdleTimer(existing);
    existing.busy = true;
    return existing.resource as T;
  }

  // Fingerprint changed, database reopened, or process exited: dispose stale resource before cold-starting.
  await disposePooledExternalSession(conversationId, true);
  if (options?.nativeSessionId) {
    await disposePooledExternalSessionsByNativeId(options.nativeSessionId, true);
  }
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
    void startTrackedDisposal(conversationId, previous, true);
  }

  if (!entry.isAlive()) {
    pool.delete(conversationId);
    void startTrackedDisposal(conversationId, entry, true);
    return;
  }

  const stored: StoredPoolEntry = {
    ...(entry as PooledExternalSessionEntry<unknown>),
    busy: false,
    dbRef: currentDbIdentity(),
    binaryStamp: readBinaryStamp(entry.executablePath),
  };
  stored.idleTimer = setTimeout(() => {
    const latest = pool.get(conversationId);
    if (latest !== stored || latest.busy) return;
    pool.delete(conversationId);
    void startTrackedDisposal(conversationId, stored, false, 'Idle external runtime session dispose failed');
  }, idleTtlMs);
  stored.idleTimer.unref();
  pool.set(conversationId, stored);
}

/** Close and evict any pooled external runtime process for `conversationId`, awaiting in-flight disposals. */
export async function disposePooledExternalSession(conversationId: string, force = false): Promise<void> {
  const existing = pool.get(conversationId);
  if (existing) {
    pool.delete(conversationId);
    clearIdleTimer(existing);
    await startTrackedDisposal(conversationId, existing, force);
  }
  await awaitInFlight(inFlightByConversation, conversationId);
}

/** Close and evict any idle pooled external runtime processes holding `nativeSessionId`. */
export async function disposePooledExternalSessionsByNativeId(
  nativeSessionId: string,
  force = false,
): Promise<void> {
  if (!nativeSessionId) return;
  const matchingIds: string[] = [];
  for (const [conversationId, entry] of pool) {
    if (entry.nativeSessionId === nativeSessionId && !entry.busy) {
      matchingIds.push(conversationId);
    }
  }
  await Promise.all(matchingIds.map((id) => disposePooledExternalSession(id, force)));
  await awaitInFlight(inFlightByNativeId, nativeSessionId);
}

/** Close and evict every pooled external runtime process (used on shutdown). */
export async function disposeAllPooledExternalSessions(force = false): Promise<void> {
  const ids = [...pool.keys()];
  await Promise.all(ids.map((id) => disposePooledExternalSession(id, force)));
  while (inFlightByConversation.size > 0 || inFlightByNativeId.size > 0) {
    const pending: Promise<void>[] = [];
    for (const set of inFlightByConversation.values()) pending.push(...set);
    for (const set of inFlightByNativeId.values()) pending.push(...set);
    if (pending.length === 0) break;
    await Promise.allSettled(pending);
  }
}

export function getPooledExternalSessionCount(): number {
  return pool.size;
}
