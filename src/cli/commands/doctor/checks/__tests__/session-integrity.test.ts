import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigSchema } from '../../../../../config/schema.js';
import { SessionStore } from '../../../../../session/store.js';
import { closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../../storage/sqlite/connection.js';
import { checkSessionIntegrity } from '../session-integrity.js';

const testConfig = ConfigSchema.parse({});

describe('checkSessionIntegrity', () => {
  it('scans standalone agent session directories outside agents.list', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'xopc-doctor-session-test-'));
    const previousStateDir = process.env.XOPC_STATE_DIR;
    const stateDir = join(tempDir, '.state');
    const configPath = join(tempDir, 'xopc.json');
    process.env.XOPC_STATE_DIR = stateDir;

    try {
      await writeFile(configPath, '{}\n');
      const standaloneStore = new SessionStore({ config: testConfig, agentId: 'coder' });
      await standaloneStore.initialize();
      await standaloneStore.saveMessages('agent:coder:webchat:default:direct:doctor', [
        { role: 'user', content: 'hello', timestamp: Date.now() },
      ]);

      const result = await checkSessionIntegrity({
        configPath,
        stateDir,
        options: {
          fix: false,
          json: false,
          deep: true,
          security: false,
        },
      });

      expect(result.status).toBe('pass');
      expect(result.message).toContain('1 session(s)');
      expect(result.hints).toEqual([]);
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.XOPC_STATE_DIR;
      } else {
        process.env.XOPC_STATE_DIR = previousStateDir;
      }
      closeXopcDatabase();
      resetXopcDatabaseSingletonForTest();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
