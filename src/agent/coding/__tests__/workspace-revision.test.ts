import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readWorkspaceRevision } from '../workspace-revision.js';

describe('workspace revision', () => {
  it('detects tracked and untracked edits without changing user Git state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-revision-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    try {
      git('init', '-q');
      await writeFile(join(root, 'source.ts'), 'before');
      git('add', '.');
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture');
      const first = await readWorkspaceRevision(root);
      expect(first).toBeTruthy();
      await writeFile(join(root, 'source.ts'), 'after');
      const second = await readWorkspaceRevision(root);
      expect(second).not.toBe(first);
      await writeFile(join(root, 'new.ts'), 'new');
      const status = git('status', '--porcelain');
      const third = await readWorkspaceRevision(root);
      expect(third).not.toBe(second);
      await writeFile(join(root, 'new.ts'), 'changed untracked');
      expect(await readWorkspaceRevision(root)).not.toBe(third);
      expect(git('status', '--porcelain')).toBe(status);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

it('fingerprints and reviews untracked files in a repository without a first commit', async () => {
  const { createReviewWorkspaceTool } = await import('../../tools/review-workspace.js');
  const root = await mkdtemp(join(tmpdir(), 'unborn-revision-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    const empty = await readWorkspaceRevision(root);
    expect(empty).toMatch(/^[a-f0-9]{64}$/);
    await writeFile(join(root, 'new.ts'), 'export const created = true;');
    expect(await readWorkspaceRevision(root)).not.toBe(empty);
    const reviewed = await createReviewWorkspaceTool(root).execute('review', {});
    expect(reviewed.details.complete).toBe(true);
    expect((reviewed.content[0] as { text: string }).text).toContain('export const created = true;');
  } finally { await rm(root, { recursive: true, force: true }); }
});
