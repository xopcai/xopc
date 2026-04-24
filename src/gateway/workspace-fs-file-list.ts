import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { createLogger } from '../utils/logger.js';

const log = createLogger('WorkspaceFsFileList');

/** Match ripgrep `--glob` excludes in `runRipgrepListFiles` (keep list aligned where possible). */
const SKIP_DIR_NAMES = new Set(['node_modules', '.git']);

/**
 * Recursive workspace file list (relative POSIX paths). Used when ripgrep `--files` yields nothing
 * (missing binary, spawn failure, or environment quirks) but the tree should still be searchable.
 */
export async function listWorkspaceRelativeFilesFsFallback(
  workspaceRootAbs: string,
  maxFiles: number,
): Promise<string[]> {
  const cap = Math.min(Math.max(maxFiles, 1), 200_000);
  const out: string[] = [];

  async function walk(dirAbs: string): Promise<void> {
    if (out.length >= cap) return;
    let entries;
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch (err) {
      log.debug({ err, dirAbs }, 'fs list: readdir failed');
      return;
    }
    for (const e of entries) {
      if (out.length >= cap) return;
      if (e.name.startsWith('.')) continue;
      const full = join(dirAbs, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIR_NAMES.has(e.name)) continue;
        await walk(full);
      } else if (e.isFile()) {
        const rel = relative(workspaceRootAbs, full);
        if (!rel || rel.startsWith('..')) continue;
        out.push(rel.split('\\').join('/'));
      }
    }
  }

  try {
    await walk(workspaceRootAbs);
  } catch (err) {
    log.warn({ err, workspaceRootAbs }, 'fs list: walk failed');
  }
  return out;
}
