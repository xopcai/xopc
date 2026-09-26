import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  getSqliteDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../../storage/sqlite/index.js';
import { checkDatabaseRelations } from '../database-relations.js';

describe('checkDatabaseRelations', () => {
  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('reports an orphan implicit relation in deep mode', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'xopc-doctor-relations-'));
    const configPath = join(tempDir, 'xopc.json');
    try {
      await writeFile(configPath, '{}\n');
      openXopcDatabase({ path: join(tempDir, 'xopc.db') });
      getSqliteDatabase().prepare(`INSERT INTO session_inputs (
        id, conversation_id, client_message_id, requested_delivery, effective_delivery,
        status, content, attachments_json, origin_json, position, version, created_at_ms, updated_at_ms
      ) VALUES ('input', 'missing-conversation', 'message', 'next', 'next', 'queued',
        'hello', '[]', '{}', 1, 1, 1, 1)`).run();

      const result = await checkDatabaseRelations({
        configPath,
        stateDir: tempDir,
        options: { fix: false, json: false, deep: true, security: false },
      });

      expect(result.status).toBe('warn');
      expect(result.hints).toContain('1 orphan queued session input record(s)');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('skips the relation scan outside deep mode', async () => {
    const result = await checkDatabaseRelations({
      configPath: 'unused',
      stateDir: 'unused',
      options: { fix: false, json: false, deep: false, security: false },
    });
    expect(result.status).toBe('skip');
  });
});
