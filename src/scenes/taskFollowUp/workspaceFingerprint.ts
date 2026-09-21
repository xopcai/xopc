import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runGit } from '../../execution-environments/git.js';

/** Bind verification to tracked and non-ignored files without executing repository code. */
export async function workspaceFingerprint(workspace: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await runGit(workspace, ['rev-parse', 'HEAD']));
  hash.update(await runGit(workspace, ['symbolic-ref', '--quiet', 'HEAD']));
  const paths = [...new Set((await runGit(workspace, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean))].sort();
  if (paths.length > 20_000) throw new Error('Workspace verification file budget exceeded');
  let bytes = 0;
  for (const path of paths) {
    const file = resolve(workspace, path);
    hash.update(JSON.stringify(path));
    const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!stat) { hash.update('deleted'); continue; }
    hash.update(String(stat.mode));
    if (stat.isSymbolicLink()) hash.update(await readlink(file));
    else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > 256 * 1024 * 1024) throw new Error('Workspace verification size budget exceeded');
      hash.update(await readFile(file));
    } else throw new Error('Submodules and special files require a separate verification workspace');
  }
  return hash.digest('hex');
}
