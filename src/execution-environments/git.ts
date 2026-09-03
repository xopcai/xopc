import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { runExec } from '../infra/exec.js';

const GIT_TIMEOUT_MS = 30_000;
const MAX_ERROR_OUTPUT = 2_000;

export interface GitRepositoryInfo {
  repositoryRoot: string;
  gitCommonDir: string;
  headSha: string;
  branchRef?: string;
  dirty: boolean;
}

export interface GitWorktreeEntry {
  path: string;
  headSha?: string;
  branchRef?: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

export class GitExecutionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GitExecutionError';
  }
}

function errorOutput(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const value = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
  const output = [value.stderr, value.stdout, value.message]
    .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
    .join('\n')
    .trim();
  return output.slice(-MAX_ERROR_OUTPUT);
}

export async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    return (await runExec('git', args, { cwd, timeoutMs: GIT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 })).stdout;
  } catch (error) {
    throw new GitExecutionError(`git ${args[0] ?? 'command'} failed: ${errorOutput(error)}`, { cause: error });
  }
}

async function canonicalPath(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

export async function inspectGitRepository(workspacePath: string): Promise<GitRepositoryInfo> {
  const repositoryRoot = await canonicalPath((await runGit(workspacePath, ['rev-parse', '--show-toplevel'])).trim());
  const rawCommonDir = (await runGit(repositoryRoot, ['rev-parse', '--git-common-dir'])).trim();
  const gitCommonDir = await canonicalPath(isAbsolute(rawCommonDir) ? rawCommonDir : resolve(repositoryRoot, rawCommonDir));
  const headSha = (await runGit(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  const branchRef = (await runGit(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim();
  const dirty = Boolean((await runGit(repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).length);
  return {
    repositoryRoot,
    gitCommonDir,
    headSha,
    ...(branchRef ? { branchRef } : {}),
    dirty,
  };
}

export async function resolveGitCommit(repositoryRoot: string, ref: string): Promise<string> {
  const normalized = ref.trim();
  if (!normalized) throw new Error('Git starting ref is required');
  return (await runGit(repositoryRoot, ['rev-parse', '--verify', `${normalized}^{commit}`])).trim();
}

export async function resolveGitRemoteUrl(repositoryRoot: string, remote = 'origin'): Promise<string> {
  const name = remote.trim();
  if (!name) throw new Error('Git remote name is required');
  const url = (await runGit(repositoryRoot, ['remote', 'get-url', name])).trim();
  if (!url) throw new Error(`Git remote has no URL: ${name}`);
  return url;
}

export function parseGitWorktreeList(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | undefined;
  const pushCurrent = () => {
    if (current) entries.push(current);
    current = undefined;
  };

  for (const token of output.split('\0')) {
    if (!token) {
      pushCurrent();
      continue;
    }
    const separator = token.indexOf(' ');
    const key = separator === -1 ? token : token.slice(0, separator);
    const value = separator === -1 ? '' : token.slice(separator + 1);
    if (key === 'worktree') {
      pushCurrent();
      current = { path: value, bare: false, detached: false, locked: false, prunable: false };
      continue;
    }
    if (!current) continue;
    if (key === 'HEAD') current.headSha = value;
    else if (key === 'branch') current.branchRef = value;
    else if (key === 'bare') current.bare = true;
    else if (key === 'detached') current.detached = true;
    else if (key === 'locked') current.locked = true;
    else if (key === 'prunable') current.prunable = true;
  }
  pushCurrent();
  return entries;
}

export async function listGitWorktrees(repositoryRoot: string): Promise<GitWorktreeEntry[]> {
  return parseGitWorktreeList(await runGit(repositoryRoot, ['worktree', 'list', '--porcelain', '-z']));
}

export async function findGitWorktree(
  repositoryRoot: string,
  worktreePath: string,
): Promise<GitWorktreeEntry | undefined> {
  const expected = await canonicalPath(worktreePath);
  const entries = await listGitWorktrees(repositoryRoot);
  for (const entry of entries) {
    if (await canonicalPath(entry.path) === expected) return entry;
  }
  return undefined;
}
