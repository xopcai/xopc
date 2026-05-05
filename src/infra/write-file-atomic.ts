/**
 * Durable single-file writes: temp file → fsync → rename to target.
 * Avoids torn JSON when the process dies mid-write.
 */

import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, open, rename, rm, copyFile, chmod } from 'node:fs/promises';
import path from 'node:path';

function errno(err: unknown): string | undefined {
  return err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
}

function replaceTempWithTargetSync(tempPath: string, filePath: string, mode: number): void {
  try {
    renameSync(tempPath, filePath);
    return;
  } catch (err) {
    const code = errno(err);
    if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EEXIST')) {
      throw err;
    }
  }

  copyFileSync(tempPath, filePath);
  try {
    chmodSync(filePath, mode);
  } catch {
    /* best-effort */
  }
  rmSync(tempPath, { force: true });
}

async function replaceTempWithTarget(tempPath: string, filePath: string, mode: number): Promise<void> {
  try {
    await rename(tempPath, filePath);
    return;
  } catch (err) {
    const code = errno(err);
    if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EEXIST')) {
      throw err;
    }
  }

  await copyFile(tempPath, filePath);
  try {
    await chmod(filePath, mode);
  } catch {
    /* best-effort */
  }
  await rm(tempPath, { force: true }).catch(() => undefined);
}

/**
 * Write UTF-8 text atomically. Creates parent directories when missing.
 */
export async function writeTextAtomic(
  filePath: string,
  content: string,
  options?: { mode?: number; ensureDirMode?: number },
): Promise<void> {
  const mode = options?.mode ?? 0o600;
  const dir = path.dirname(filePath);
  const mkdirOpts: { recursive: true; mode?: number } = { recursive: true };
  if (typeof options?.ensureDirMode === 'number') {
    mkdirOpts.mode = options.ensureDirMode;
  }
  await mkdir(dir, mkdirOpts);

  const tmp = `${filePath}.${randomUUID()}.tmp`;
  try {
    const handle = await open(tmp, 'w', mode);
    try {
      await handle.writeFile(content, { encoding: 'utf8' });
      await handle.sync();
    } finally {
      await handle.close().catch(() => undefined);
    }
    try {
      await chmod(tmp, mode);
    } catch {
      /* best-effort */
    }
    await replaceTempWithTarget(tmp, filePath, mode);
    try {
      await chmod(filePath, mode);
    } catch {
      /* best-effort */
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined);
  }

  try {
    const dirHandle = await open(dir, 'r');
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close().catch(() => undefined);
    }
  } catch {
    /* best-effort directory sync */
  }
}

/**
 * Synchronous atomic UTF-8 write (temp → fsync → rename). For CLI / sync stores.
 */
export function writeTextAtomicSync(
  filePath: string,
  content: string,
  options?: { mode?: number; ensureDirMode?: number },
): void {
  const mode = options?.mode ?? 0o600;
  const dir = path.dirname(filePath);
  const mkdirOpts: { recursive: true; mode?: number } = { recursive: true };
  if (typeof options?.ensureDirMode === 'number') {
    mkdirOpts.mode = options.ensureDirMode;
  }
  mkdirSync(dir, mkdirOpts);

  const tmp = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, content, { encoding: 'utf8' });
    const fd = openSync(tmp, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      chmodSync(tmp, mode);
    } catch {
      /* best-effort */
    }
    replaceTempWithTargetSync(tmp, filePath, mode);
    try {
      chmodSync(filePath, mode);
    } catch {
      /* best-effort */
    }
  } finally {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}
