import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import type { MemorySearchOptions } from '../../prompt/memory/index.js';
import { createLogger } from '../../../utils/logger.js';
import {
  SHORT_TERM_PROMOTION_LOCK_RELATIVE,
  SHORT_TERM_RECALL_STORE_RELATIVE,
} from './constants.js';
import { buildEntryKey, clamp01, isoDay, normalizeMemoryPath } from './utils.js';

const log = createLogger('Dreaming:Store');
const STORE_MAX_ENTRIES = 2_000;
const STORE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1_000;
const PROMOTED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const LOCK_STALE_MS = 60_000;

export type DreamingStoreEntry = {
  key: string;
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;

  // ── Signal dimensions ────────────────────────────────────────────────
  /** Number of times this snippet was returned by a memory recall query. */
  recallCount: number;
  /** Number of times recorded from source-side sweep phases. */
  sourceCount: number;
  /** Number of times replayed from grounded context (agent-initiated). */
  groundedCount: number;
  /** Number of times the light phase touched this entry. */
  lightHits: number;
  /** Number of times the REM phase touched this entry. */
  remHits: number;
  /** Cross-phase hit count (light + deep + rem combined touches). */
  phaseHitCount: number;
  /** Weighted aggregate of all signal dimensions. */
  totalSignalCount: number;

  // ── Score tracking ───────────────────────────────────────────────────
  totalScore: number;
  maxScore: number;
  queryHashes: string[];
  recallDays: string[];

  // ── Timestamps ───────────────────────────────────────────────────────
  firstRecalledAt: string;
  lastRecalledAt: string;
  lastObservedAt?: string;
  promotedAt?: string;
};

export type DreamingStore = {
  version: 1;
  updatedAt: string;
  entries: Record<string, DreamingStoreEntry>;
};

type MemoryMatch = Awaited<ReturnType<typeof import('../../prompt/memory/index.js').memorySearch>>[number];

function isRecordableMemoryPath(rel: string): boolean {
  const p = normalizeMemoryPath(rel);
  return p.length > 0 && !p.startsWith('../') && !path.isAbsolute(p);
}

function hashQuery(query: string): string {
  return createHash('sha1').update(query.trim().toLowerCase()).digest('hex').slice(0, 12);
}

function mergeRecentDistinct(existing: string[], nextValue: string, limit: number): string[] {
  const seen = new Set<string>();
  const normalized = existing
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && !seen.has(v) && (seen.add(v), true));
  if (nextValue && !normalized.includes(nextValue)) {
    normalized.push(nextValue);
  }
  return normalized.length <= limit ? normalized : normalized.slice(-limit);
}

function mergeQueryHashes(existing: string[], nextHash: string): string[] {
  const out = mergeRecentDistinct(existing, nextHash, 32);
  return out;
}

function emptyStore(nowIso: string): DreamingStore {
  return { version: 1, updatedAt: nowIso, entries: {} };
}

async function ensureDreamDir(dreamingRoot: string): Promise<string> {
  const dir = path.join(dreamingRoot, path.dirname(SHORT_TERM_RECALL_STORE_RELATIVE));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function readStore(dreamingRoot: string, nowIso: string): Promise<DreamingStore> {
  const storePath = path.join(dreamingRoot, SHORT_TERM_RECALL_STORE_RELATIVE);
  try {
    const raw = await fs.readFile(storePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Dreaming store root must be an object');
    }
    const rec = parsed as Partial<DreamingStore>;
    if (rec.version !== 1 || !rec.entries || typeof rec.entries !== 'object') {
      throw new Error('Dreaming store has an unsupported or invalid shape');
    }
    return {
      version: 1,
      updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : nowIso,
      entries: rec.entries as Record<string, DreamingStoreEntry>,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') return emptyStore(nowIso);
    const quarantinePath = `${storePath}.corrupt-${Date.now()}`;
    await fs.rename(storePath, quarantinePath).catch(() => undefined);
    log.warn({ err, dreamingRoot, quarantinePath }, 'Failed to read dreaming store; quarantined corrupt data');
    return emptyStore(nowIso);
  }
}

function pruneStore(store: DreamingStore, nowMs = Date.now()): void {
  for (const [key, entry] of Object.entries(store.entries)) {
    const lastSeenMs = Math.max(
      Date.parse(entry.lastRecalledAt || entry.firstRecalledAt),
      entry.lastObservedAt ? Date.parse(entry.lastObservedAt) : 0,
    );
    const promotedMs = entry.promotedAt ? Date.parse(entry.promotedAt) : Number.NaN;
    if (
      (Number.isFinite(promotedMs) && nowMs - promotedMs > PROMOTED_MAX_AGE_MS)
      || (Number.isFinite(lastSeenMs) && nowMs - lastSeenMs > STORE_MAX_AGE_MS)
    ) {
      delete store.entries[key];
    }
  }
  const entries = Object.values(store.entries);
  if (entries.length <= STORE_MAX_ENTRIES) return;
  entries.sort((left, right) => {
    if (Boolean(left.promotedAt) !== Boolean(right.promotedAt)) return left.promotedAt ? 1 : -1;
    const signalDelta = (right.totalSignalCount ?? 0) - (left.totalSignalCount ?? 0);
    if (signalDelta !== 0) return signalDelta;
    return Date.parse(right.lastRecalledAt) - Date.parse(left.lastRecalledAt);
  });
  const keep = new Set(entries.slice(0, STORE_MAX_ENTRIES).map((entry) => entry.key));
  for (const key of Object.keys(store.entries)) {
    if (!keep.has(key)) delete store.entries[key];
  }
}

async function writeStore(dreamingRoot: string, store: DreamingStore): Promise<void> {
  pruneStore(store);
  await ensureDreamDir(dreamingRoot);
  const storePath = path.join(dreamingRoot, SHORT_TERM_RECALL_STORE_RELATIVE);
  const tmp = `${storePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
  await fs.rename(tmp, storePath);
}

export async function recordDreamingRecalls(params: {
  dreamingRoot: string;
  query: string;
  matches: MemoryMatch[];
  options?: MemorySearchOptions;
  now?: Date;
}): Promise<{ recorded: number; skipped: number; storePath: string }> {
  const dreamingRoot = params.dreamingRoot.trim();
  const query = params.query.trim();
  if (!dreamingRoot || !query) {
    return { recorded: 0, skipped: params.matches.length, storePath: SHORT_TERM_RECALL_STORE_RELATIVE };
  }
  return withDreamingStoreLock(dreamingRoot, async () => {
    const now = params.now ?? new Date();
    const nowIso = now.toISOString();
    const dayBucket = isoDay(now);
    const qHash = hashQuery(query);
    const store = await readStore(dreamingRoot, nowIso);

    let recorded = 0;
    let skipped = 0;
    for (const match of params.matches) {
      const file = typeof match?.file === 'string' ? match.file : '';
      if (!file || !isRecordableMemoryPath(file)) {
        skipped += 1;
        continue;
      }
      const lines = typeof match?.lines === 'string' ? match.lines.trim() : '';
      const lineNumbers = Array.isArray(match?.lineNumbers) ? match.lineNumbers : [];
      const startLine = Math.max(1, Math.min(...lineNumbers.filter((n) => Number.isFinite(n) && n > 0)));
      const endLine = Math.max(startLine, Math.max(...lineNumbers.filter((n) => Number.isFinite(n) && n > 0)));
      if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) {
        skipped += 1;
        continue;
      }
      const score = clamp01(Number(match.score));
      const key = buildEntryKey({ path: file, startLine, endLine });
      const existing = store.entries[key];
      const snippet = lines.length > 0 ? lines.slice(0, 360) : file;

      const next: DreamingStoreEntry = existing
        ? {
            ...existing,
            snippet,
            recallCount: Math.max(0, Math.floor(existing.recallCount + 1)),
            sourceCount: existing.sourceCount ?? 0,
            groundedCount: existing.groundedCount ?? 0,
            lightHits: existing.lightHits ?? 0,
            remHits: existing.remHits ?? 0,
            phaseHitCount: existing.phaseHitCount ?? 0,
            totalSignalCount: Math.max(0, (existing.totalSignalCount ?? existing.recallCount ?? 0) + 1),
            totalScore: Math.max(0, existing.totalScore + score),
            maxScore: Math.max(existing.maxScore, score),
            queryHashes: mergeQueryHashes(existing.queryHashes ?? [], qHash),
            recallDays: mergeRecentDistinct(existing.recallDays ?? [], dayBucket, 16),
            lastRecalledAt: nowIso,
          }
        : {
            key,
            path: normalizeMemoryPath(file),
            startLine,
            endLine,
            snippet,
            recallCount: 1,
            sourceCount: 0,
            groundedCount: 0,
            lightHits: 0,
            remHits: 0,
            phaseHitCount: 0,
            totalSignalCount: 1,
            totalScore: score,
            maxScore: score,
            queryHashes: [qHash],
            recallDays: [dayBucket],
            firstRecalledAt: nowIso,
            lastRecalledAt: nowIso,
          };

      store.entries[key] = next;
      recorded += 1;
    }

    if (recorded > 0) {
      store.updatedAt = nowIso;
      await writeStore(dreamingRoot, store);
    }

    return { recorded, skipped, storePath: SHORT_TERM_RECALL_STORE_RELATIVE };
  });
}

/** Serialize all read-modify-write operations against the shared Dreaming store. */
export async function withDreamingStoreLock<T>(
  dreamingRoot: string,
  task: () => Promise<T>,
): Promise<T> {
  const lockPath = path.join(dreamingRoot, SHORT_TERM_PROMOTION_LOCK_RELATIVE);
  await ensureDreamDir(dreamingRoot);

  const startedAt = Date.now();
  const timeoutMs = 10_000;
  const retryDelayMs = 50;

  while (true) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(`${process.pid}:${Date.now()}\n`, 'utf-8').catch(() => undefined);
      try {
        return await task();
      } finally {
        await handle.close().catch(() => undefined);
        await fs.unlink(lockPath).catch(() => undefined);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'EEXIST') {
        throw err;
      }
      const lockStat = await fs.stat(lockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > LOCK_STALE_MS && await lockOwnerIsDead(lockPath)) {
        await fs.unlink(lockPath).catch(() => undefined);
        log.warn({ lockPath, ageMs: Date.now() - lockStat.mtimeMs }, 'Removed stale dreaming lock');
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for dreaming promotion lock at ${lockPath}`);
      }
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
}

/** @deprecated Use the store-level name; retained for callers outside this module. */
export async function withDreamingPromotionLock<T>(
  dreamingRoot: string,
  task: () => Promise<T>,
): Promise<T> {
  return withDreamingStoreLock(dreamingRoot, task);
}

async function lockOwnerIsDead(lockPath: string): Promise<boolean> {
  const raw = await fs.readFile(lockPath, 'utf-8').catch(() => '');
  const pid = Number.parseInt(raw.split(':', 1)[0] ?? '', 10);
  if (!Number.isFinite(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === 'ESRCH';
  }
}

export async function loadDreamingStore(params: {
  dreamingRoot: string;
}): Promise<{ store: DreamingStore; storePath: string }> {
  const nowIso = new Date().toISOString();
  const store = await readStore(params.dreamingRoot, nowIso);
  return { store, storePath: SHORT_TERM_RECALL_STORE_RELATIVE };
}

export async function saveDreamingStore(params: {
  dreamingRoot: string;
  store: DreamingStore;
}): Promise<void> {
  await writeStore(params.dreamingRoot, params.store);
}

export async function resetDreamingStore(params: {
  dreamingRoot: string;
  now?: Date;
}): Promise<number> {
  return withDreamingStoreLock(params.dreamingRoot, async () => {
    const nowIso = (params.now ?? new Date()).toISOString();
    const store = await readStore(params.dreamingRoot, nowIso);
    const removed = Object.keys(store.entries).length;
    await writeStore(params.dreamingRoot, emptyStore(nowIso));
    return removed;
  });
}

/** Remove only a stale lock whose owning process is no longer alive. */
export async function clearStaleDreamingLock(dreamingRoot: string): Promise<boolean> {
  const lockPath = path.join(dreamingRoot, SHORT_TERM_PROMOTION_LOCK_RELATIVE);
  const lockStat = await fs.stat(lockPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return null;
    throw error;
  });
  if (!lockStat) return false;
  const ageMs = Date.now() - lockStat.mtimeMs;
  if (ageMs <= LOCK_STALE_MS || !(await lockOwnerIsDead(lockPath))) {
    throw new Error(`Dreaming lock is active and cannot be cleared: ${lockPath}`);
  }
  await fs.unlink(lockPath);
  log.warn({ lockPath, ageMs }, 'Cleared stale dreaming lock');
  return true;
}

// ── Phase-level signal helpers ─────────────────────────────────────────

type PhaseSignalField = 'sourceCount' | 'groundedCount' | 'lightHits' | 'remHits';

/**
 * Increment a phase-specific signal counter on an existing store entry.
 * Also bumps `phaseHitCount` and `totalSignalCount`.
 * Returns `true` if the entry existed and was updated.
 */
export function bumpEntryPhaseSignal(
  entry: DreamingStoreEntry,
  field: PhaseSignalField,
  increment = 1,
): void {
  entry[field] = (entry[field] ?? 0) + increment;
  entry.phaseHitCount = (entry.phaseHitCount ?? 0) + increment;
  entry.totalSignalCount = (entry.totalSignalCount ?? 0) + increment;
}
