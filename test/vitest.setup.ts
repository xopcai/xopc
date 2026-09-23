import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach } from 'vitest';

import { AgentCatalogRepository } from '../src/agent-catalog/repository.js';
import { isXopcDatabaseOpen, openXopcDatabase } from '../src/storage/sqlite/index.js';

const stateDirKey = 'XOPC_VITEST_STATE_DIR';

if (!process.env[stateDirKey]) {
  const stateDir = mkdtempSync(join(tmpdir(), `xopc-vitest-${process.pid}-`));
  process.env[stateDirKey] = stateDir;
  process.once('exit', () => {
    try {
      rmSync(stateDir, { recursive: true, force: true });
    } catch {
      // The OS temp directory can clean up files still held by a terminating worker.
    }
  });
}

// Never let tests that use default storage paths open the user's live database.
process.env.XOPC_STATE_DIR = process.env[stateDirKey];

// Production entry points bootstrap the catalog before loading runtime code.
// Unit tests call those runtime helpers directly, so give each test an explicit
// ready catalog unless its own fixture replaces the database in a local hook.
beforeEach(() => {
  if (!isXopcDatabaseOpen()) openXopcDatabase({ path: ':memory:' });
  const repository = new AgentCatalogRepository();
  try {
    repository.getSettings();
  } catch {
    repository.ensureInitialized();
  }
  const main = repository.get('main');
  if (main && main.provisioningState !== 'ready') repository.markProvisioned('main');
});
