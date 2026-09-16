import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import { requireNodeSqlite } from '../../../infra/node-sqlite.js';
import {
  backupBeforeConversationCutover,
  flushBackupFile,
} from '../migrations/conversation-backup.js';

it('flushes the backup through a writable, non-truncating handle', () => {
  const operations = {
    open: vi.fn(() => 42),
    fsync: vi.fn(),
    close: vi.fn(),
  };

  flushBackupFile('xopc.db.pre-v178.bak', operations);

  expect(operations.open).toHaveBeenCalledWith('xopc.db.pre-v178.bak', 'r+');
  expect(operations.fsync).toHaveBeenCalledWith(42);
  expect(operations.close).toHaveBeenCalledWith(42);
});

it('closes the backup handle when flushing fails', () => {
  const operations = {
    open: vi.fn(() => 42),
    fsync: vi.fn(() => { throw new Error('flush failed'); }),
    close: vi.fn(),
  };

  expect(() => flushBackupFile('xopc.db.pre-v178.bak', operations)).toThrow('flush failed');
  expect(operations.close).toHaveBeenCalledWith(42);
});

it('refuses the cutover while another process holds the database and succeeds after it exits', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xopc-cutover-owner-'));
  const databasePath = join(directory, 'xopc.db');
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES (\'preserved\')');
  const child = spawn(process.execPath, ['-e',
    "require('node:fs').openSync(process.env.XOPC_TEST_DATABASE, 'r'); process.stdin.resume(); process.stdout.write('ready');",
  ], { env: { ...process.env, XOPC_TEST_DATABASE: databasePath }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  try {
    await Promise.race([once(child.stdout, 'data'), once(child, 'error').then(([error]) => { throw error; })]);
    expect(() => backupBeforeConversationCutover(db, databasePath)).toThrow('Stop other xopc database processes');
    expect(readdirSync(directory).some(name => name.endsWith('.bak'))).toBe(false);
    expect(db.prepare('SELECT value FROM sentinel').get()?.value).toBe('preserved');
    child.kill();
    await exited;
    const backup = new DatabaseSync(backupBeforeConversationCutover(db, databasePath), { readOnly: true });
    try { expect(backup.prepare('SELECT value FROM sentinel').get()?.value).toBe('preserved'); }
    finally { backup.close(); }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 45_000);
