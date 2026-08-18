import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { resolveOAuthPath } from '../config/paths.js';

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 90_000;
const STALE_LOCK_MS = 60_000;

const providerModificationTails = new Map<string, Promise<void>>();
const heldProviderLocks = new AsyncLocalStorage<ReadonlySet<string>>();

interface OAuthProviderLockOptions {
  signal?: AbortSignal;
}

function lockPath(providerId: string): string {
  return `${resolveOAuthPath(providerId.toLowerCase())}.lock`;
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST';
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

async function removeStaleLock(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs < STALE_LOCK_MS) return false;
    await rm(path, { force: true });
    return true;
  } catch (error) {
    if (isMissing(error)) return true;
    throw error;
  }
}

async function acquireFileLock(
  providerId: string,
  options: OAuthProviderLockOptions,
): Promise<() => Promise<void>> {
  const path = lockPath(providerId);
  const owner = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  await mkdir(dirname(path), { recursive: true });

  while (true) {
    options.signal?.throwIfAborted();
    try {
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(owner, 'utf8');
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          if (await readFile(path, 'utf8') === owner) {
            await rm(path, { force: true });
          }
        } catch {
          // The lock may already have been removed after a stale-owner recovery.
        }
      };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (await removeStaleLock(path)) continue;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for OAuth credential lock for ${providerId}`);
      }
      await delay(LOCK_RETRY_MS, undefined, options.signal ? { signal: options.signal } : undefined);
    }
  }
}

export async function withOAuthProviderLock<T>(
  providerId: string,
  operation: () => Promise<T>,
  options: OAuthProviderLockOptions = {},
): Promise<T> {
  const normalizedProvider = providerId.toLowerCase();
  const heldLocks = heldProviderLocks.getStore();
  if (heldLocks?.has(normalizedProvider)) return operation();

  const previous = providerModificationTails.get(normalizedProvider) ?? Promise.resolve();
  let releaseQueue!: () => void;
  const queueGate = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => queueGate);
  providerModificationTails.set(normalizedProvider, tail);

  await previous.catch(() => undefined);
  let releaseFileLock: (() => Promise<void>) | undefined;
  try {
    releaseFileLock = await acquireFileLock(normalizedProvider, options);
    const nextHeldLocks = new Set(heldLocks);
    nextHeldLocks.add(normalizedProvider);
    return await heldProviderLocks.run(nextHeldLocks, operation);
  } finally {
    await releaseFileLock?.();
    releaseQueue();
    if (providerModificationTails.get(normalizedProvider) === tail) {
      providerModificationTails.delete(normalizedProvider);
    }
  }
}
