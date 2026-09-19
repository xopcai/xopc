import { mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import { assertManagedWorktreePath, readDirectoryIdentity, sameDirectoryIdentity } from '../worktree-safety.js';

describe('worktree safety', () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))));

  it('only accepts descendants of the managed worktree root', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'xopc-worktree-safety-'));
    roots.push(stateDir);
    expect(() => assertManagedWorktreePath(join(stateDir, 'worktrees', 'project', 'environment'), stateDir)).not.toThrow();
    expect(() => assertManagedWorktreePath(stateDir, stateDir)).toThrow(/outside/);
    expect(() => assertManagedWorktreePath(join(stateDir, 'other'), stateDir)).toThrow(/outside/);
  });

  it('rejects symlinks and detects replacement directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-worktree-identity-'));
    roots.push(root);
    const original = join(root, 'original');
    const link = join(root, 'link');
    const replacement = join(root, 'replacement');
    await Promise.all([mkdir(original), mkdir(replacement)]);
    const identity = await readDirectoryIdentity(original);
    await symlink(original, link, 'dir');
    await expect(readDirectoryIdentity(link)).rejects.toThrow(/symlinked/);
    expect(sameDirectoryIdentity(identity!, await readDirectoryIdentity(replacement))).toBe(false);
  });
});
