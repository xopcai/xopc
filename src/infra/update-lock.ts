// src/infra/update-lock.ts

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { resolveUpdateLockPath } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('UpdateLock');

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

type LockInfo = {
  pid: number;
  startedAt: string;
  source: 'gateway' | 'cli' | 'auto';
};

function resolveLockPath(): string {
  return resolveUpdateLockPath();
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to acquire the update lock. Returns a release function on success, or null if
 * another live process holds the lock.
 */
export async function acquireUpdateLock(
  source: LockInfo['source'],
): Promise<{ release: () => Promise<void> } | null> {
  const lockPath = resolveLockPath();

  try {
    const raw = await readFile(lockPath, 'utf-8');
    const existing = JSON.parse(raw) as LockInfo;
    const startedAt = Date.parse(existing.startedAt);
    const age = Date.now() - startedAt;

    if (isProcessAlive(existing.pid) && age < STALE_THRESHOLD_MS) {
      log.info(
        { existingPid: existing.pid, source: existing.source, ageMs: age },
        'Update lock held by another live process',
      );
      return null;
    }

    log.warn(
      { existingPid: existing.pid, source: existing.source, ageMs: age },
      'Reclaiming stale update lock',
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn({ err }, 'Failed to read update lock; proceeding');
    }
  }

  const info: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    source,
  };

  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, JSON.stringify(info, null, 2), 'utf-8');

  const release = async () => {
    try {
      const raw = await readFile(lockPath, 'utf-8');
      const current = JSON.parse(raw) as LockInfo;
      if (current.pid === process.pid) {
        await unlink(lockPath);
      }
    } catch {
      // Lock already released or stolen — fine
    }
  };

  return { release };
}
