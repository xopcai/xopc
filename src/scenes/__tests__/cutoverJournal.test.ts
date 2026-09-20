import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertSceneCutoverReady, commitSceneCutover, resumeSceneCutover } from '../cutoverJournal.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

describe('offline database/configuration cutover boundary', () => {
  let directory: string;
  let configPath: string;
  let db: DatabaseSync;
  const config = { gateway: { port: 18790, heartbeat: { enabled: true, prompt: 'Private checklist' } }, providers: { example: { apiKey: 'private-key' } } };
  const convert = vi.fn((database: DatabaseSync, source: Readonly<Record<string, unknown>>) => {
    expect(source).toEqual(config);
    database.exec(`CREATE TABLE scene_conversion_fixture(id TEXT PRIMARY KEY, summary TEXT);
      INSERT INTO scene_conversion_fixture SELECT id, summary FROM proactive_insights;
      DROP TABLE proactive_insights`);
    return undefined;
  });
  beforeEach(async () => {
    convert.mockClear(); vi.mocked(rename).mockClear();
    directory = await mkdtemp(join(tmpdir(), 'xopc-scene-journal-'));
    configPath = join(directory, 'xopc.json');
    await writeFile(configPath, JSON.stringify(config));
    db = new DatabaseSync(join(directory, 'xopc.db'));
    db.exec("PRAGMA journal_mode = WAL; CREATE TABLE proactive_insights(id TEXT PRIMARY KEY, summary TEXT); INSERT INTO proactive_insights VALUES ('result', 'Private result')");
  });
  afterEach(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  const run = () => commitSceneCutover({ db, configPath, backupRoot: directory, convert });

  it('commits normalized data and only removes the retired configuration field', async () => {
    const result = await run();
    expect(db.prepare('SELECT * FROM scene_conversion_fixture').all()).toMatchObject([{ id: 'result', summary: 'Private result' }]);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ ...config, gateway: { port: 18790 } });
    expect(() => assertSceneCutoverReady(db)).not.toThrow();
    expect(JSON.stringify(result)).not.toContain('Private');
    await run(); expect(convert).toHaveBeenCalledOnce();
  });

  it('rolls back all database mutations and leaves the configuration untouched when conversion fails', async () => {
    await expect(commitSceneCutover({ db, configPath, backupRoot: directory, convert: (database) => {
      database.exec('DELETE FROM proactive_insights'); throw new Error('Injected mapping failure');
    } })).rejects.toThrow('mapping failure');
    expect(db.prepare('SELECT count(*) AS n FROM proactive_insights').get()?.n).toBe(1);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(config);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'scene_cutover_journal'").get()).toBeUndefined();
  });

  it('blocks worker startup after database commit and resumes a failed configuration rename without replay', async () => {
    vi.mocked(rename).mockRejectedValueOnce(new Error('Injected disk failure'));
    await expect(run()).rejects.toThrow('disk failure');
    expect(() => assertSceneCutoverReady(db)).toThrow('recovery');
    expect(db.prepare('SELECT phase FROM scene_cutover_journal').get()?.phase).toBe('db_committed');
    await run(); expect(convert).toHaveBeenCalledOnce();
    expect(() => assertSceneCutoverReady(db)).not.toThrow();
  });

  it('finishes the journal when the configuration was replaced before a crash', async () => {
    vi.mocked(rename).mockRejectedValueOnce(new Error('Stop before rename'));
    await expect(run()).rejects.toThrow('Stop');
    const pending = String(db.prepare('SELECT pending_path FROM scene_cutover_journal').get()?.pending_path);
    await rename(pending, configPath);
    db.close(); db = new DatabaseSync(join(directory, 'xopc.db'));
    await resumeSceneCutover(db, configPath);
    expect(() => assertSceneCutoverReady(db)).not.toThrow();
    expect(convert).toHaveBeenCalledOnce();
  });

  it('does not overwrite a user edit made after the database commit', async () => {
    vi.mocked(rename).mockRejectedValueOnce(new Error('Stop'));
    await expect(run()).rejects.toThrow('Stop');
    await writeFile(configPath, JSON.stringify({ ...config, userEdit: true }));
    await expect(run()).rejects.toThrow('reconcile');
    expect(JSON.parse(await readFile(configPath, 'utf8')).userEdit).toBe(true);
    expect(() => assertSceneCutoverReady(db)).toThrow('recovery');
  });

  it('refuses an incomplete converter and unknown tables without deleting history', async () => {
    await expect(commitSceneCutover({ db, configPath, backupRoot: directory, convert: () => {} })).rejects.toThrow('old tables');
    db.exec('CREATE TABLE proactive_unknown(id TEXT)');
    await expect(run()).rejects.toThrow('unmapped_table');
    expect(convert).not.toHaveBeenCalled();
    expect(db.prepare('SELECT count(*) AS n FROM proactive_insights').get()?.n).toBe(1);
  });

  it('does not install a tampered pending configuration', async () => {
    vi.mocked(rename).mockRejectedValueOnce(new Error('Stop'));
    await expect(run()).rejects.toThrow('Stop');
    const pending = String(db.prepare('SELECT pending_path FROM scene_cutover_journal').get()?.pending_path);
    await writeFile(pending, '{"tampered":true}');
    await expect(resumeSceneCutover(db, configPath)).rejects.toThrow('hash mismatch');
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(config);
    expect(() => assertSceneCutoverReady(db)).toThrow('recovery');
  });

  it('rolls back when normalized rows contain broken references', async () => {
    await expect(commitSceneCutover({ db, configPath, backupRoot: directory, convert: (database) => {
      database.exec(`DROP TABLE proactive_insights;
        CREATE TABLE scene_parent(id TEXT PRIMARY KEY);
        CREATE TABLE scene_child(parent_id TEXT REFERENCES scene_parent(id) DEFERRABLE INITIALLY DEFERRED);
        INSERT INTO scene_child VALUES ('missing')`);
    } })).rejects.toThrow('foreign keys');
    expect(db.prepare('SELECT count(*) AS n FROM proactive_insights').get()?.n).toBe(1);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(config);
  });
});
