import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { WORKSPACE_FILES } from '../../../config/paths.js';
import { seedWorkspaceBootstrapFiles } from '../workspace-seed.js';
import { BOOTSTRAP_FILES } from '../workspace.js';

describe('workspace-seed', () => {
  it('creates missing bootstrap files from templates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-ws-'));
    try {
      seedWorkspaceBootstrapFiles(dir);
      const expected = [...BOOTSTRAP_FILES, WORKSPACE_FILES.BOOTSTRAP];
      for (const name of expected) {
        const p = join(dir, name);
        const raw = readFileSync(p, 'utf-8');
        expect(raw.length).toBeGreaterThan(10);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('replaces IDENTITY name placeholder when displayName is provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-ws-'));
    try {
      seedWorkspaceBootstrapFiles(dir, { displayName: 'Research Buddy' });
      const raw = readFileSync(join(dir, WORKSPACE_FILES.IDENTITY), 'utf-8');
      expect(raw).toContain('Research Buddy');
      expect(raw).not.toContain('_(pick something you like)_');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

});
