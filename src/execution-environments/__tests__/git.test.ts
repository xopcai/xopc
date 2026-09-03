import { describe, expect, it } from 'vitest';

import { parseGitWorktreeList } from '../git.js';

describe('parseGitWorktreeList', () => {
  it('parses detached, locked, and branch worktrees from nul-delimited output', () => {
    const output = [
      'worktree /repo',
      'HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'branch refs/heads/main',
      '',
      'worktree /state/worktrees/project/environment',
      'HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'detached',
      'locked xopc',
      '',
    ].join('\0');

    expect(parseGitWorktreeList(output)).toEqual([
      {
        path: '/repo',
        headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        branchRef: 'refs/heads/main',
        bare: false,
        detached: false,
        locked: false,
        prunable: false,
      },
      {
        path: '/state/worktrees/project/environment',
        headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        bare: false,
        detached: true,
        locked: true,
        prunable: false,
      },
    ]);
  });
});
