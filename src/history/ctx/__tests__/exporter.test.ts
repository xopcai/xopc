import { readFile, stat } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendTranscriptEntry,
  closeXopcDatabase,
  deleteSessionRecord,
  ensureSessionRecord,
  openXopcDatabase,
  resetSessionRecord,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { exportCtxHistory } from '../exporter.js';

describe('exportCtxHistory', () => {
  let stateDir: string;
  let outputDir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-ctx-export-'));
    outputDir = join(stateDir, 'export');
    resetXopcDatabaseSingletonForTest();
    db = openXopcDatabase({ path: join(stateDir, 'xopc.db') }).db;
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('exports reset generations deterministically and excludes deleted session keys', async () => {
    const first = ensureSessionRecord('agent:main:test', '/workspace', {
      agentId: 'main',
      sessionType: 'chat',
    });
    appendTranscriptEntry('agent:main:test', { role: 'user', content: 'first generation' });
    const reset = resetSessionRecord('agent:main:test', '/workspace');
    expect(reset?.previousSessionId).toBe(first.sessionId);
    appendTranscriptEntry('agent:main:test', { role: 'assistant', content: 'second generation' });

    const firstExport = await exportCtxHistory(db, { outputDir });
    const firstContents = await readFile(firstExport.historyPath, 'utf8');
    const firstMtime = (await stat(firstExport.historyPath)).mtimeMs;
    const secondExport = await exportCtxHistory(db, { outputDir });

    expect(firstExport).toMatchObject({ sessionCount: 2, eventCount: 2, changed: true });
    expect(secondExport.changed).toBe(false);
    expect(await readFile(secondExport.historyPath, 'utf8')).toBe(firstContents);
    expect((await stat(secondExport.historyPath)).mtimeMs).toBe(firstMtime);

    expect(deleteSessionRecord('agent:main:test')).toBe(true);
    const afterDelete = await exportCtxHistory(db, { outputDir });
    expect(afterDelete).toMatchObject({ sessionCount: 0, eventCount: 0, changed: true });
  });

  it('keeps the last valid export when a transcript payload is malformed', async () => {
    const session = ensureSessionRecord('agent:main:test', '/workspace', { agentId: 'main' });
    appendTranscriptEntry('agent:main:test', { role: 'user', content: 'valid history' });
    const initial = await exportCtxHistory(db, { outputDir });
    const validContents = await readFile(initial.historyPath, 'utf8');

    db.prepare(
      `INSERT INTO transcript_entries
       (entry_id, session_id, seq, entry_kind, role, payload_json, created_at)
       VALUES (?, ?, ?, 'message', 'user', ?, ?)`,
    ).run('broken-entry', session.sessionId, 2, '{not-json', Date.now());

    await expect(exportCtxHistory(db, { outputDir })).rejects.toThrow(
      'Invalid transcript payload for entry broken-entry',
    );
    expect(await readFile(initial.historyPath, 'utf8')).toBe(validContents);
  });

  it('writes private files and uses the configured state directory by default', async () => {
    const result = await exportCtxHistory(db, {
      env: { XOPC_STATE_DIR: stateDir },
    });

    expect(result.outputDir).toBe(join(stateDir, 'exports', 'ctx'));
    if (process.platform !== 'win32') {
      expect((await stat(result.historyPath)).mode & 0o777).toBe(0o600);
      expect((await stat(result.manifestPath)).mode & 0o777).toBe(0o600);
      expect((await stat(result.outputDir)).mode & 0o777).toBe(0o700);
    }
  });
});
