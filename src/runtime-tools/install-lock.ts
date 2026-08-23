import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

const LOCK_STALE_MS = 30 * 60 * 1_000;
const LOCK_WAIT_MS = 250;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function staleLock(path: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { pid?: unknown; createdAt?: unknown };
    const pid = typeof value.pid === 'number' ? value.pid : 0;
    const createdAt = typeof value.createdAt === 'number' ? value.createdAt : 0;
    return !isProcessAlive(pid) && Date.now() - createdAt > LOCK_STALE_MS;
  } catch {
    return true;
  }
}

export async function withInstallLock<T>(
  path: string,
  metadata: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  while (true) {
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
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
    }
  }

  try {
    return await fn();
  } finally {
    await unlink(path).catch(() => undefined);
  }
}
