import { existsSync } from 'node:fs';

import { createLogger } from '../utils/logger.js';

const log = createLogger('WorkspaceRipgrep');

/** Ripgrep binaries inside `app.asar` are not executable (spawn throws ENOTDIR). */
export function isAsarBundledPath(filePath: string): boolean {
  return filePath.includes('.asar');
}

/** True when `filePath` is a real on-disk executable candidate (not inside asar). */
export function isRunnableRipgrepPath(filePath: string): boolean {
  const trimmed = filePath.trim();
  if (!trimmed || isAsarBundledPath(trimmed)) return false;
  return existsSync(trimmed);
}

let cachedRipgrepBin: string | undefined;

/** @internal Test-only — clears memoized ripgrep path between cases. */
export function resetRipgrepBinaryCacheForTests(): void {
  cachedRipgrepBin = undefined;
}

/**
 * Resolve ripgrep binary:
 * 1. `XOPC_RIPGREP_BIN` (Electron extraResources `bin/rg`)
 * 2. `@vscode/ripgrep` postinstall path (dev / CLI)
 * 3. `rg` on PATH
 */
export async function resolveRipgrepBinary(): Promise<string> {
  if (cachedRipgrepBin) return cachedRipgrepBin;

  const envBin = process.env.XOPC_RIPGREP_BIN?.trim();
  if (envBin && isRunnableRipgrepPath(envBin)) {
    cachedRipgrepBin = envBin;
    return envBin;
  }

  let bin = 'rg';
  try {
    const { rgPath } = await import('@vscode/ripgrep');
    if (typeof rgPath === 'string' && rgPath.length > 0) {
      if (isRunnableRipgrepPath(rgPath)) {
        bin = rgPath;
      } else if (isAsarBundledPath(rgPath)) {
        log.debug({ rgPath }, '@vscode/ripgrep path is inside app.asar; will try rg on PATH or XOPC_RIPGREP_BIN');
      } else {
        log.debug({ rgPath }, '@vscode/ripgrep binary not on disk; will try rg on PATH');
      }
    }
  } catch {
    // pnpm may skip @vscode/ripgrep postinstall; package dir can be missing.
  }
  cachedRipgrepBin = bin;
  return bin;
}
