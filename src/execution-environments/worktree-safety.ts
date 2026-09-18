import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { listGitWorktrees } from './git.js';
import { resolveExecutionWorktreesRoot } from './paths.js';

export interface DirectoryIdentity {
  dev: number;
  ino: number;
}

function isInside(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return Boolean(child)
    && !isAbsolute(child)
    && child !== '..'
    && !child.startsWith(`..${sep}`)
    && resolve(parent, child) === candidate;
}

export function assertManagedWorktreePath(rootPath: string, stateDir?: string, repositoryRoot?: string): void {
  const managedRoot = resolve(resolveExecutionWorktreesRoot(stateDir));
  const candidate = resolve(rootPath);
  if (!isInside(managedRoot, candidate)) {
    throw new Error(`Refusing to manage worktree outside ${managedRoot}`);
  }
  if (candidate === resolve(homedir()) || candidate === resolve('/')) {
    throw new Error(`Refusing to manage protected path ${candidate}`);
  }
  if (repositoryRoot && candidate === resolve(repositoryRoot)) {
    throw new Error('Refusing to manage the repository root as a worktree');
  }
}

export async function readDirectoryIdentity(path: string): Promise<DirectoryIdentity | undefined> {
  try {
    const value = await lstat(path);
    if (value.isSymbolicLink()) throw new Error(`Refusing to manage symlinked worktree path: ${path}`);
    if (!value.isDirectory()) throw new Error(`Worktree path is not a directory: ${path}`);
    return { dev: value.dev, ino: value.ino };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function assertNoNestedRegisteredWorktrees(repositoryRoot: string, rootPath: string): Promise<void> {
  const candidate = resolve(rootPath);
  for (const worktree of await listGitWorktrees(repositoryRoot)) {
    const registered = resolve(worktree.path);
    if (registered !== candidate && isInside(candidate, registered)) {
      throw new Error(`Refusing to remove worktree containing registered worktree ${registered}`);
    }
  }
}

export function sameDirectoryIdentity(expected: DirectoryIdentity, actual: DirectoryIdentity | undefined): boolean {
  return actual?.dev === expected.dev && actual.ino === expected.ino;
}
