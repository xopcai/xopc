import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
