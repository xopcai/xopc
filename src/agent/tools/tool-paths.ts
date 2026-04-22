import { basename, isAbsolute, normalize, resolve } from 'node:path';
import { BOOTSTRAP_FILES } from '../context/workspace.js';

const BOOTSTRAP_NAME_LOWER = new Set(BOOTSTRAP_FILES.map((f) => f.toLowerCase()));

/**
 * Paths from the model: relative paths are under `workspaceRoot`; absolute paths are normalized.
 */
export function resolvePathUnderWorkspace(userPath: string, workspaceRoot: string): string {
  const t = userPath.trim();
  if (!t) return workspaceRoot;
  if (isAbsolute(t)) {
    return normalize(t);
  }
  return resolve(workspaceRoot, t);
}

/** True if `userPath` is only a bootstrap filename, e.g. `SOUL.md` or `.\SOUL.md` (basename matches). */
export function isBareBootstrapFileName(userPath: string): boolean {
  const b = basename(userPath.replace(/\\/g, '/'));
  if (!b || b === '.' || b === '..') return false;
  return BOOTSTRAP_NAME_LOWER.has(b.toLowerCase());
}

/**
 * If `userPath` refers to a bootstrap file by name, resolve under `bootstrapDir`.
 */
export function resolveBootstrapPathIfBareName(userPath: string, bootstrapDir: string): string {
  return resolve(bootstrapDir, basename(userPath.replace(/\\/g, '/')));
}
