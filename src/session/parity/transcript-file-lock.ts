/**
 * Cross-process (and re-entrant same-process) advisory lock for session transcript JSONL.
 * Aligns with the goal of safe concurrent gateway/CLI access; same idea as OpenClaw's
 * session write lock, but scoped to a single transcript path with a smaller surface area.
 */

import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_STALE_MS = 30 * 60 * 1000;

type LockPayload = { pid?: number; createdAt?: string };

type HeldTranscriptLock = {
  refcount: number;
  handle: FileHandle;
  lockFile: string;
};

const heldLocks = new Map<string, HeldTranscriptLock>();

/** Same-process serialization for acquire; cross-process exclusion uses the lock file. */
const acquireChains = new Map<string, Promise<void>>();

function chainPerTranscript<T>(normalized: string, fn: () => Promise<T>): Promise<T> {
  const prev = acquireChains.get(normalized) ?? Promise.resolve();
  const run = prev.then(() => fn());
  acquireChains.set(
    normalized,
    run.then(() => undefined).catch(() => undefined),
  );
  return run;
}

function normalizeTranscriptPath(transcriptAbsPath: string): string {
  return path.resolve(transcriptAbsPath);
}

function lockPathFor(transcriptAbsPath: string): string {
  const dir = path.dirname(transcriptAbsPath);
  const base = path.basename(transcriptAbsPath);
  const hash = createHash('sha256').update(transcriptAbsPath).digest('hex').slice(0, 16);
  return path.join(dir, `.${base}.${hash}.xopc-transcript.lock`);
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readPayload(lockFile: string): Promise<LockPayload | null> {
  try {
    const raw = await readFile(lockFile, 'utf8');
    return JSON.parse(raw) as LockPayload;
  } catch {
    return null;
  }
}

async function isStaleLock(lockFile: string, staleMs: number): Promise<boolean> {
  let st;
  try {
    st = await stat(lockFile);
  } catch {
    return true;
  }
  const age = Date.now() - st.mtimeMs;
  if (age > staleMs) {
    return true;
  }
  const payload = await readPayload(lockFile);
  const pid = typeof payload?.pid === 'number' ? payload.pid : undefined;
  if (pid != null && pid !== process.pid && !isPidAlive(pid)) {
    return true;
  }
  return false;
}

async function releaseHeldLock(normalized: string, held: HeldTranscriptLock): Promise<void> {
  held.refcount -= 1;
  if (held.refcount > 0) {
    return;
  }
  heldLocks.delete(normalized);
  try {
    await held.handle.close();
  } catch {
    /* ignore */
  }
  try {
    await rm(held.lockFile, { force: true });
  } catch {
    /* ignore */
  }
}

export type TranscriptFileLock = { release: () => Promise<void> };

/**
 * Acquire an exclusive lock for mutations to `transcriptAbsPath`.
 * Re-entrant on the same path in the same process (nested `withTranscriptFileLock`).
 */
export async function acquireTranscriptFileLock(
  transcriptAbsPath: string,
  opts?: { timeoutMs?: number; staleMs?: number },
): Promise<TranscriptFileLock> {
  const normalized = normalizeTranscriptPath(transcriptAbsPath);
  return chainPerTranscript(normalized, () => acquireTranscriptFileLockBody(normalized, opts));
}

async function acquireTranscriptFileLockBody(
  normalized: string,
  opts?: { timeoutMs?: number; staleMs?: number },
): Promise<TranscriptFileLock> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;

  const existing = heldLocks.get(normalized);
  if (existing) {
    existing.refcount += 1;
    return {
      release: async () => {
        await releaseHeldLock(normalized, existing);
      },
    };
  }

  const lockFile = lockPathFor(normalized);
  await mkdir(path.dirname(lockFile), { recursive: true });

  const started = Date.now();
  let handle: FileHandle | null = null;

  while (Date.now() - started < timeoutMs) {
    try {
      handle = await open(lockFile, 'wx', 0o600);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        if (await isStaleLock(lockFile, staleMs)) {
          await rm(lockFile, { force: true });
          continue;
        }
        await new Promise((r) => setTimeout(r, 50 + Math.floor(Math.random() * 40)));
        continue;
      }
      throw err;
    }
  }

  if (!handle) {
    throw new Error(`timeout acquiring transcript lock: ${lockFile}`);
  }

  const payload: LockPayload = { pid: process.pid, createdAt: new Date().toISOString() };
  await handle.writeFile(JSON.stringify(payload, null, 2), 'utf8');

  const held: HeldTranscriptLock = { refcount: 1, handle, lockFile };
  heldLocks.set(normalized, held);

  return {
    release: async () => {
      await releaseHeldLock(normalized, held);
    },
  };
}

export async function withTranscriptFileLock<T>(
  transcriptAbsPath: string,
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number; staleMs?: number },
): Promise<T> {
  const lock = await acquireTranscriptFileLock(transcriptAbsPath, opts);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/** Best-effort: remove a stale lock without acquiring (e.g. doctor tooling). */
export async function tryRemoveStaleTranscriptLock(
  transcriptAbsPath: string,
  staleMs: number = DEFAULT_STALE_MS,
): Promise<boolean> {
  const lockFile = lockPathFor(normalizeTranscriptPath(transcriptAbsPath));
  if (!existsSync(lockFile)) {
    return false;
  }
  if (!(await isStaleLock(lockFile, staleMs))) {
    return false;
  }
  await rm(lockFile, { force: true });
  return true;
}
