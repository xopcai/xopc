import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { createApplyPatchTool } from '../apply-patch.js';

describe('apply_patch tool', () => {
  it('adds and updates files with structured diff details', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-patch-'));
    try {
      await writeFile(join(workspace, 'existing.txt'), 'alpha\nbeta\n', 'utf-8');
      const tool = createApplyPatchTool(workspace);

      const added = await tool.execute('tc1', {
        patch: [
          '*** Begin Patch',
          '*** Add File: created.txt',
          '+one',
          '+two',
          '*** End Patch',
        ].join('\n'),
      });
      expect(await readFile(join(workspace, 'created.txt'), 'utf-8')).toBe('one\ntwo\n');
      expect(added.details.changes[0]).toMatchObject({ kind: 'add', path: 'created.txt' });
      expect(added.details.files).toEqual(['created.txt']);
      expect(added.details.summary).toContain('add: created.txt');
      expect(added.details.diff).toContain('+one');

      const updated = await tool.execute('tc2', {
        patch: [
          '*** Begin Patch',
          '*** Update File: existing.txt',
          '@@',
          ' alpha',
          '-beta',
          '+gamma',
          '*** End Patch',
        ].join('\n'),
      });
      expect(await readFile(join(workspace, 'existing.txt'), 'utf-8')).toBe('alpha\ngamma\n');
      expect(updated.details.changes[0]).toMatchObject({ kind: 'update', path: 'existing.txt' });
      expect(updated.details.added).toBeGreaterThan(0);
      expect(updated.details.removed).toBeGreaterThan(0);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('throws actionable errors when an update hunk does not match', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-patch-'));
    try {
      await writeFile(join(workspace, 'existing.txt'), 'alpha\nbeta\n', 'utf-8');
      const tool = createApplyPatchTool(workspace);

      await expect(
        tool.execute('tc3', {
          patch: [
            '*** Begin Patch',
            '*** Update File: existing.txt',
            '@@',
            ' alpha',
            '-missing',
            '+gamma',
            '*** End Patch',
          ].join('\n'),
        }),
      ).rejects.toThrow('Re-read the target lines');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
