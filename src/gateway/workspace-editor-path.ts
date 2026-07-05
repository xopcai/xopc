import fs from 'node:fs';
import path, { relative, resolve } from 'node:path';

/** Resolve a workspace-relative POSIX path safely (no `..`, stays under root). */
export function resolveWorkspaceSafePath(workspaceRoot: string, rel: string): string | null {
  const trimmed = rel.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (trimmed.includes('..')) return null;
  const abs = resolve(workspaceRoot, trimmed);
  const root = resolve(workspaceRoot);
  const relToRoot = relative(root, abs);
  if (relToRoot.startsWith('..') || relToRoot.split(/[/\\]/).includes('..')) return null;
  return abs;
}

export function toWorkspaceRelativePosix(workspaceRoot: string, absPath: string): string {
  return relative(resolve(workspaceRoot), absPath).replace(/\\/g, '/') || '';
}

export function isPathUnderWorkspace(workspaceRoot: string, absPath: string): boolean {
  const root = normalizeComparablePath(workspaceRoot);
  const candidate = normalizeComparablePath(absPath);
  const relToRoot = relative(root, candidate);
  return relToRoot === '' || (!relToRoot.startsWith('..') && !path.isAbsolute(relToRoot));
}

function normalizeComparablePath(input: string): string {
  let resolved = resolve(input);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    /* keep lexical path for paths that do not exist yet */
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
