import { basename, isAbsolute, normalize, resolve } from 'node:path';
import { AGENT_PROFILE_MARKDOWN_SYSTEM_FILES } from '../context/workspace.js';

const PROFILE_SYSTEM_MARKDOWN_NAME_LOWER = new Set(
  AGENT_PROFILE_MARKDOWN_SYSTEM_FILES.map((f) => f.toLowerCase()),
);

/**
 * Paths from the model: relative paths are under `workspaceRoot`; absolute paths are normalized.
 *
 * Security: resolves `..` traversal and normalizes the path. For absolute paths the caller
 * should additionally run sandbox path-policy validation when enforcement is enabled.
 */
export function resolvePathUnderWorkspace(userPath: string, workspaceRoot: string): string {
  const t = userPath.trim();
  if (!t) return workspaceRoot;
  if (isAbsolute(t)) {
    return normalize(t);
  }
  return resolve(workspaceRoot, t);
}

/** True if `userPath` is only a profile-system filename, e.g. `SOUL.md` or `.\SOUL.md` (basename matches). */
export function isBareProfileMarkdownFileName(userPath: string): boolean {
  const b = basename(userPath.replace(/\\/g, '/'));
  if (!b || b === '.' || b === '..') return false;
  return PROFILE_SYSTEM_MARKDOWN_NAME_LOWER.has(b.toLowerCase());
}

/**
 * If `userPath` refers to a profile Markdown file by name, resolve under `profileMarkdownRoot`.
 */
export function resolveProfileMarkdownPathIfBareName(userPath: string, profileMarkdownRoot: string): string {
  return resolve(profileMarkdownRoot, basename(userPath.replace(/\\/g, '/')));
}
