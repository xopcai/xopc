import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import type { MemorySearchOptions } from '../../prompt/memory/index.js';
import { createLogger } from '../../../utils/logger.js';
import {
  SHORT_TERM_PROMOTION_LOCK_RELATIVE,
  SHORT_TERM_RECALL_STORE_RELATIVE,
} from './constants.js';

const log = createLogger('Dreaming:Store');

export type DreamingStoreEntry = {
  key: string;
  path: string; // workspace-relative: memory/YYYY-MM-DD.md
  startLine: number;
  endLine: number;
  snippet: string;

  // ── Signal dimensions ────────────────────────────────────────────────
  /** Number of times this snippet was returned by a memory recall query. */
  recallCount: number;
  /** Number of times recorded from daily log scanning (light sweep). */
  dailyCount: number;
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
  promotedAt?: string;
};

export type DreamingStore = {
  version: 1;
  updatedAt: string;
  entries: Record<string, DreamingStoreEntry>;
};

type MemoryMatch = Awaited<ReturnType<typeof import('../../prompt/memory/index.js').memorySearch>>[number];

function normalizeMemoryPath(raw: string): string {
  return raw.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isDailyWorkspaceMemoryPath(rel: string): boolean {
  const p = normalizeMemoryPath(rel);
  return /^memory\/\d{4}-\d{2}-\d{2}\.md$/i.test(p);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function hashQuery(query: string): string {
  return createHash('sha1').update(query.trim().toLowerCase()).digest('hex').slice(0, 12);
}

function buildEntryKey(params: { path: string; startLine: number; endLine: number }): string {
  return `memory:${normalizeMemoryPath(params.path)}:${params.startLine}:${params.endLine}`;
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

async function ensureDreamDir(workspaceDir: string): Promise<string> {
  const dir = path.join(workspaceDir, path.dirname(SHORT_TERM_RECALL_STORE_RELATIVE));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function readStore(workspaceDir: string, nowIso: string): Promise<DreamingStore> {
  const storePath = path.join(workspaceDir, SHORT_TERM_RECALL_STORE_RELATIVE);
  try {
    const raw = await fs.readFile(storePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return emptyStore(nowIso);
    const rec = parsed as Partial<DreamingStore>;
    if (rec.version !== 1 || !rec.entries || typeof rec.entries !== 'object') {
      return emptyStore(nowIso);
    }
    return {
      version: 1,
      updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : nowIso,
      entries: rec.entries as Record<string, DreamingStoreEntry>,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') return emptyStore(nowIso);
    log.warn({ err, workspaceDir }, 'Failed to read dreaming store; resetting');
    return emptyStore(nowIso);
  }
}

async function writeStore(workspaceDir: string, store: DreamingStore): Promise<void> {
  await ensureDreamDir(workspaceDir);
  const storePath = path.join(workspaceDir, SHORT_TERM_RECALL_STORE_RELATIVE);
  const tmp = `${storePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
  await fs.rename(tmp, storePath);
}

export async function recordDreamingRecalls(params: {
  workspaceDir: string;
  query: string;
  matches: MemoryMatch[];
  options?: MemorySearchOptions;
  now?: Date;
}): Promise<{ recorded: number; skipped: number; storePath: string }> {
  const workspaceDir = params.workspaceDir.trim();
  const query = params.query.trim();
  if (!workspaceDir || !query) {
    return { recorded: 0, skipped: params.matches.length, storePath: SHORT_TERM_RECALL_STORE_RELATIVE };
  }
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const dayBucket = isoDay(now);
  const qHash = hashQuery(query);

  const store = await readStore(workspaceDir, nowIso);

  let recorded = 0;
  let skipped = 0;
  for (const match of params.matches) {
    const file = typeof match?.file === "string" ? match.file : "";
    if (!file || !isDailyWorkspaceMemoryPath(file)) {
      skipped += 1;
      continue;
    }
    const lines = typeof match?.lines === "string" ? match.lines.trim() : "";
    const lineNumbers = Array.isArray(match?.lineNumbers) ? match.lineNumbers : [];
    const startLine = Math.max(1, Math.min(...lineNumbers.filter((n) => Number.isFinite(n) && n > 0)));
    const endLine = Math.max(startLine, Math.max(...lineNumbers.filter((n) => Number.isFinite(n) && n > 0)));
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) {
      skipped += 1;
      continue;
    }
    const score = clampScore(Number(match.score));
    const key = buildEntryKey({ path: file, startLine, endLine });
    const existing = store.entries[key];
    const snippet = lines.length > 0 ? lines.slice(0, 360) : file;

    const next: DreamingStoreEntry = existing
      ? {
          ...existing,
          snippet,
          recallCount: Math.max(0, Math.floor(existing.recallCount + 1)),
          dailyCount: existing.dailyCount ?? 0,
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
          dailyCount: 0,
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
    await writeStore(workspaceDir, store);
  }

  return {
    recorded,
    skipped,
    storePath: SHORT_TERM_RECALL_STORE_RELATIVE,
  };
}

export async function withDreamingPromotionLock<T>(
  workspaceDir: string,
  task: () => Promise<T>,
): Promise<T> {
  const lockPath = path.join(workspaceDir, SHORT_TERM_PROMOTION_LOCK_RELATIVE);
  await ensureDreamDir(workspaceDir);

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
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for dreaming promotion lock at ${lockPath}`);
      }
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
}

export async function loadDreamingStore(params: {
  workspaceDir: string;
}): Promise<{ store: DreamingStore; storePath: string }> {
  const nowIso = new Date().toISOString();
  const store = await readStore(params.workspaceDir, nowIso);
  return { store, storePath: SHORT_TERM_RECALL_STORE_RELATIVE };
}

export async function saveDreamingStore(params: {
  workspaceDir: string;
  store: DreamingStore;
}): Promise<void> {
  await writeStore(params.workspaceDir, params.store);
}

// ── Phase-level signal helpers ─────────────────────────────────────────

type PhaseSignalField = 'dailyCount' | 'groundedCount' | 'lightHits' | 'remHits';

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

