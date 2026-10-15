import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createReviewWorkspaceTool } from '../review-workspace.js';

describe('Workspace review availability', () => {
  it('reports a non-Git workspace once without certifying a complete review or creating Git state', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'xopc-review-unavailable-'));
    try {
      const result = await createReviewWorkspaceTool(workspace).execute('plain-files', {});
      expect(result.details).toMatchObject({ status: 'unavailable', complete: false, reason: 'not_git_repository' });
      expect(JSON.stringify(result.content)).toContain('Do not retry this unchanged call');
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  });
  it('retains complete Git review for an unborn repository with a real untracked text file', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'xopc-review-git-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: workspace });
      writeFileSync(join(workspace, 'report.txt'), 'Verified file content');
      const result = await createReviewWorkspaceTool(workspace).execute('git-files', {});
      expect(result.details).toMatchObject({ status: 'success', complete: true });
      expect(JSON.stringify(result.content)).toContain('Verified file content');
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  });
});
