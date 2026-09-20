import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSceneCutoverSnapshot, restoreSceneCutoverSnapshot, verifySceneCutoverSnapshot } from '../cutoverSnapshot.js';

describe('scene cutover snapshot preparation', () => {
  let directory: string;
  let db: DatabaseSync;
  let configPath: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'xopc-scene-snapshot-test-'));
    db = new DatabaseSync(join(directory, 'source.db'));
    db.exec(`PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      CREATE TABLE proactive_runs(status TEXT, private_prompt TEXT);
      INSERT INTO proactive_runs VALUES ('completed', 'private message');`);
    configPath = join(directory, 'source.json');
    await writeFile(configPath, JSON.stringify({ provider: { apiKey: 'private-key' } }));
  });
  afterEach(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });

  it('captures committed WAL content and restores only into a fresh directory', async () => {
    const before = db.prepare('SELECT total_changes() AS n').get()?.n;
    const snapshot = await createSceneCutoverSnapshot({ db, backupRoot: directory, configPath });
    expect(snapshot.report.tables).toMatchObject([{ name: 'proactive_runs', rows: 1 }]);
    expect(JSON.stringify(snapshot)).not.toContain('private');
    expect(db.prepare('SELECT total_changes() AS n').get()?.n).toBe(before);
    db.exec("INSERT INTO proactive_runs VALUES ('completed', 'later message')");
    const destination = join(directory, 'restored');
    await restoreSceneCutoverSnapshot(snapshot.directory, destination);
    const restored = new DatabaseSync(join(destination, 'xopc.db'), { readOnly: true });
    try { expect(restored.prepare('SELECT * FROM proactive_runs').all()).toMatchObject([{ private_prompt: 'private message' }]); }
    finally { restored.close(); }
    expect(await readFile(join(destination, 'xopc.json'), 'utf8')).toBe(await readFile(configPath, 'utf8'));
    expect(await verifySceneCutoverSnapshot(snapshot.directory)).toEqual(snapshot.manifest);
    await expect(restoreSceneCutoverSnapshot(snapshot.directory, destination)).rejects.toThrow();
    if (process.platform !== 'win32') {
      expect((await stat(snapshot.directory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(destination, 'xopc.db'))).mode & 0o777).toBe(0o600);
      expect((await stat(join(destination, 'xopc.json'))).mode & 0o777).toBe(0o600);
    }
  });

  it('keeps reconciliation blockers in the snapshot report instead of pretending readiness', async () => {
    db.exec("INSERT INTO proactive_runs VALUES ('running', 'private')");
    const snapshot = await createSceneCutoverSnapshot({ db, backupRoot: directory });
    expect(snapshot.report.blockers).toEqual(['in_flight:proactive_runs:status']);
    expect(snapshot.manifest.configHash).toBeNull();
  });

  it.each(['xopc.db', 'xopc.json'])('rejects modified %s before creating a restore directory', async (asset) => {
    const snapshot = await createSceneCutoverSnapshot({ db, backupRoot: directory, configPath });
    await writeFile(join(snapshot.directory, asset), 'modified');
    const destination = join(directory, 'restored');
    await expect(restoreSceneCutoverSnapshot(snapshot.directory, destination)).rejects.toThrow('hash mismatch');
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects unsupported manifests and symlink assets', async () => {
    const snapshot = await createSceneCutoverSnapshot({ db, backupRoot: directory });
    await writeFile(join(snapshot.directory, 'manifest.json'), JSON.stringify({ ...snapshot.manifest, version: 2 }));
    await expect(verifySceneCutoverSnapshot(snapshot.directory)).rejects.toThrow();
    await writeFile(join(snapshot.directory, 'manifest.json'), JSON.stringify(snapshot.manifest));
    await rm(join(snapshot.directory, 'xopc.db'));
    await symlink(join(directory, 'source.db'), join(snapshot.directory, 'xopc.db'));
    await expect(verifySceneCutoverSnapshot(snapshot.directory)).rejects.toThrow('regular file');
  });

  it('refuses to produce a ready snapshot with broken database references', async () => {
    db.exec(`CREATE TABLE parent(id TEXT PRIMARY KEY);
      CREATE TABLE child(parent_id TEXT REFERENCES parent(id));
      PRAGMA foreign_keys = OFF;
      INSERT INTO child VALUES ('missing');`);
    await expect(createSceneCutoverSnapshot({ db, backupRoot: directory })).rejects.toThrow('foreign keys');
  });
});
