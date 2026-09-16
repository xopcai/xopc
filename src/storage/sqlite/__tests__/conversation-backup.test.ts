import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { requireNodeSqlite } from '../../../infra/node-sqlite.js';
import { backupBeforeConversationCutover } from '../migrations/conversation-backup.js';

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
