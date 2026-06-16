import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigSchema } from '../../../../../config/schema.js';
import { SessionStore } from '../../../../../session/store.js';
import { checkDatabaseSchema } from '../database-schema.js';

const testConfig = ConfigSchema.parse({});

describe('checkDatabaseSchema', () => {
  it('reports current schema version for an open database', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'xopc-doctor-db-schema-'));
    const previousStateDir = process.env.XOPC_STATE_DIR;
    const stateDir = join(tempDir, '.state');
    const configPath = join(tempDir, 'xopc.json');
    process.env.XOPC_STATE_DIR = stateDir;

    try {
      await writeFile(configPath, '{}\n');
      const store = new SessionStore({ config: testConfig, agentId: 'main' });
      await store.initialize();

      const result = await checkDatabaseSchema({
        configPath,
        stateDir,
        options: {
          fix: false,
          json: false,
          deep: false,
          security: false,
        },
      });

      expect(result.status).toBe('pass');
      expect(result.message).toMatch(/SQLite schema v1/);
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.XOPC_STATE_DIR;
      } else {
        process.env.XOPC_STATE_DIR = previousStateDir;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
