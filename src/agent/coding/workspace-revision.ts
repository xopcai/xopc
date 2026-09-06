import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, lstat, realpath, readlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** A content fingerprint, including user changes and untracked files, without changing Git state. */
export async function readWorkspaceRevision(workspace: string): Promise<string | undefined> {
  let cwd = workspace;
  const git = async (args: string[]) => (await exec('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd, timeout: 10_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })).stdout;
  try {
    cwd = await realpath(workspace);
    const root = (await git(['rev-parse', '--show-toplevel'])).trim();
    cwd = await realpath(root);
    const head = await git(['rev-parse', '--verify', 'HEAD']).catch(() => 'unborn');
    const [diff, untracked] = await Promise.all([
      head === 'unborn'
        ? Promise.all([
            git(['diff', '--no-ext-diff', '--no-textconv', '--binary', '--cached', '--']),
            git(['diff', '--no-ext-diff', '--no-textconv', '--binary', '--']),
          ]).then(parts => parts.join('\0'))
        : git(['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--']),
      git(['ls-files', '--others', '--exclude-standard', '-z']),
    ]);
    const hash = createHash('sha256').update(head).update(diff);
    for (const file of untracked.split('\0').filter(Boolean).sort()) {
      const path = resolve(cwd, file);
      const rel = relative(cwd, path);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) return undefined;
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        hash.update(file).update('\0link\0').update(await readlink(path)).update('\0');
        continue;
      }
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024) return undefined;
      hash.update(JSON.stringify([file, stat.mode])).update('\0').update(await readFile(path)).update('\0');
    }
    return hash.digest('hex');
  } catch {
    // An unavailable snapshot must never turn into a successful verification.
    return undefined;
  }
}
