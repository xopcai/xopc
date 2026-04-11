import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { WORKSPACE_FILES } from '../../../config/paths.js';
import { migrateBootstrapFilesFromLegacyWorkspace, seedWorkspaceBootstrapFiles } from '../workspace-seed.js';
import { BOOTSTRAP_FILES, DEFAULT_SOUL_FILENAME } from '../workspace.js';

describe('workspace-seed', () => {
  const prevState = process.env.XOPCBOT_STATE_DIR;

  afterEach(() => {
    if (prevState === undefined) {
      delete process.env.XOPCBOT_STATE_DIR;
    } else {
      process.env.XOPCBOT_STATE_DIR = prevState;
    }
  });

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

  it('migrateBootstrapFilesFromLegacyWorkspace copies into agent bootstrap dir', () => {
    const state = mkdtempSync(join(tmpdir(), 'xopcbot-state-'));
    const legacy = mkdtempSync(join(tmpdir(), 'xopcbot-legacy-'));
    process.env.XOPCBOT_STATE_DIR = state;
    const agentId = 'seed-migrate-agent';
    try {
      writeFileSync(join(legacy, DEFAULT_SOUL_FILENAME), 'migrated soul');
      migrateBootstrapFilesFromLegacyWorkspace({} as Config, agentId, legacy);
      const bootSoul = join(state, 'agents', agentId, 'bootstrap', WORKSPACE_FILES.SOUL);
      expect(readFileSync(bootSoul, 'utf-8')).toBe('migrated soul');
    } finally {
      rmSync(state, { recursive: true, force: true });
      rmSync(legacy, { recursive: true, force: true });
    }
  });
});
