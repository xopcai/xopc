import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

const LOCK_STALE_MS = 30 * 60 * 1_000;
const LOCK_WAIT_MS = 250;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
async function staleLock(path: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { pid?: unknown };
    const pid = typeof value.pid === 'number' ? value.pid : 0;
    return !isProcessAlive(pid);
  } catch {
    return true;
  }
}

export async function withInstallLock<T>(
  path: string,
  metadata: Record<string, unknown>,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const waitStartedAt = Date.now();
  while (true) {
    if (signal?.aborted) throw signal.reason ?? new Error('Runtime installation was aborted');
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now(), ...metadata }));
      await handle.close();
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      if (await staleLock(path)) {
        await unlink(path).catch(() => undefined);
        continue;
      }
      if (Date.now() - waitStartedAt > LOCK_STALE_MS) {
        throw new Error(`Timed out waiting for runtime installation lock: ${path}`);
      }
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          signal?.removeEventListener('abort', abort);
          resolve();
        }, LOCK_WAIT_MS);
        const abort = () => {
          clearTimeout(timeout);
          reject(signal?.reason ?? new Error('Runtime installation was aborted'));
        };
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
  }

  try {
    return await fn();
  } finally {
    await unlink(path).catch(() => undefined);
  }
}
