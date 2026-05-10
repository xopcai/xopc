import { spawnSync } from 'node:child_process';

type Cache = { cwd: string; branch: string | null; at: number };
let cache: Cache | null = null;

const TTL_MS = 5000;

/** Best-effort current git branch for footer (pi coding-agent style). */
export function getGitBranchCached(cwd: string): string | null {
  if (cache && cache.cwd === cwd && Date.now() - cache.at < TTL_MS) {
    return cache.branch;
  }
  const result = spawnSync(
    'git',
    ['--no-optional-locks', 'symbolic-ref', '--quiet', '--short', 'HEAD'],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 600,
    },
  );
  const branch =
    result.status === 0 && typeof result.stdout === 'string' && result.stdout.trim()
      ? result.stdout.trim()
      : null;
  cache = { cwd, branch, at: Date.now() };
  return branch;
}
