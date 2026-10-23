import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';




import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import { bootstrapApplicationStateSync } from '../application-state.js';

const originalStateDir = process.env.XOPC_STATE_DIR;
const directories: string[] = [];

function useTempState(): { stateDir: string; configPath: string } {
  const stateDir = mkdtempSync(join(tmpdir(), 'xopc-bootstrap-'));
  directories.push(stateDir);
  process.env.XOPC_STATE_DIR = stateDir;
  closeXopcDatabase();
  return { stateDir, configPath: join(stateDir, 'xopc.json') };
}

afterEach(() => {
  closeXopcDatabase();
  if (originalStateDir === undefined) delete process.env.XOPC_STATE_DIR;
  else process.env.XOPC_STATE_DIR = originalStateDir;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('bootstrapApplicationStateSync', () => {
  it('initializes and provisions the catalog for a new installation', () => {
    const { stateDir } = useTempState();

    bootstrapApplicationStateSync();

    const repository = new AgentCatalogRepository();
    expect(repository.listPendingProvisioningAgentIds()).toEqual([]);
    expect(repository.snapshot().agents.map((agent) => agent.id)).toEqual([
      'coder', 'conductor', 'creative', 'data-analyst', 'main', 'researcher', 'task-router', 'writer',
    ]);
    expect(existsSync(join(stateDir, 'agents', 'main', 'profile', 'IDENTITY.md'))).toBe(false);
  });
});
