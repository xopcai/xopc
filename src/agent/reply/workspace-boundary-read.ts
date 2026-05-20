import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type BoundaryReadResult =
  | { ok: true; content: string }
  | { ok: false; reason: 'outside-root' | 'missing' | 'too-large' | 'read-error' };

/**
 * Read a file relative to workspace root with path traversal guard and byte cap.
 */
export function readWorkspaceRelativeFile(params: {
  workspaceDir: string;
  relativePath: string;
  maxBytes: number;
}): BoundaryReadResult {
  const root = resolve(params.workspaceDir);
  const absolutePath = resolve(root, params.relativePath);
  if (!absolutePath.startsWith(root)) {
    return { ok: false, reason: 'outside-root' };
  }
  try {
    const buf = readFileSync(absolutePath);
    if (buf.length > params.maxBytes) {
      return { ok: false, reason: 'too-large' };
    }
    return { ok: true, content: buf.toString('utf-8') };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return { ok: false, reason: 'missing' };
    }
    return { ok: false, reason: 'read-error' };
  }
}
