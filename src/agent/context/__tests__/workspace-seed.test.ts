import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { seedWorkspaceBootstrapFiles } from '../workspace-seed.js';
import { BOOTSTRAP_FILES } from '../workspace.js';
import { WORKSPACE_FILES } from '../../../config/paths.js';

describe('workspace-seed', () => {
  it('creates missing bootstrap files from templates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopcbot-ws-'));
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
});
