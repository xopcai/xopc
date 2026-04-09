import { homedir } from 'node:os';
import { resolve, parse } from 'node:path';

/** Expand leading `~` to the user home directory. */
export function expandWorkspacePathString(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('~')) {
    return s.replace(/^~(?=$|[/\\])/, homedir());
  }
  return s;
}

/**
 * Normalize and validate a workspace directory path.
 * Returns `null` when the input is empty or resolves to a filesystem root
 * (e.g. `/` or `C:\`) — both are almost certainly misconfiguration.
 */
export function normalizeWorkspaceDir(workspaceDir?: string): string | null {
  const trimmed = workspaceDir?.trim();
  if (!trimmed) {
    return null;
  }
  const expanded = trimmed.startsWith('~') ? expandWorkspacePathString(trimmed) : trimmed;
  const resolved = resolve(expanded);
  if (resolved === parse(resolved).root) {
    return null;
  }
  return resolved;
}

/**
 * Resolve a workspace root, falling back to `process.cwd()` when the
 * provided path is empty or invalid.
 */
export function resolveWorkspaceRoot(workspaceDir?: string): string {
  return normalizeWorkspaceDir(workspaceDir) ?? process.cwd();
}
