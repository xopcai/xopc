import { createHash } from 'node:crypto';
import { chmod, lstat, mkdtemp, open, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { assertDatabaseOffline } from '../conversation-backup.js';
import { NOTIFICATION_LEDGER_TABLES, SCENE_CUTOVER_TABLES } from './schema.js';
import { readSqliteAsset } from '../../sql-assets.js';

import { inspectSceneCutover } from './preflight.js';
import { resolveSceneCutoverBindings, type SceneCutoverBindings } from './bindings.js';
import { assertSceneHistoryIntegrity } from './integrity.js';
import { createSceneCutoverSnapshot, verifySceneCutoverSnapshot } from './snapshot.js';

type Journal = { version: number; phase: string; config_path: string; pending_path: string; before_hash: string; after_hash: string; snapshot_path: string };
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function assertSceneTables(db: DatabaseSync): void {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  const missing = [...SCENE_CUTOVER_TABLES, ...NOTIFICATION_LEDGER_TABLES].filter((name) => !tables.has(name));
  if (missing.length) throw new Error(`Scene conversion is missing target tables: ${missing.join(', ')}`);
}

function offline(db: DatabaseSync): void {
  const main = db.prepare('PRAGMA database_list').all().find((row) => row.name === 'main');
  if (!main || typeof main.file !== 'string' || !main.file) throw new Error('Scene cutover requires a file-backed database');
  assertDatabaseOffline(main.file);
}

async function sync(path: string, directory = false): Promise<void> {
  if (directory && process.platform === 'win32') return;
  const handle = await open(path, directory ? 'r' : 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
}

function journal(db: DatabaseSync): Journal | undefined {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scene_cutover_journal'").get()) return;
  const rows = db.prepare('SELECT * FROM scene_cutover_journal').all() as unknown as Journal[];
  if (rows.length !== 1 || rows[0].version !== 1 || !['db_committed', 'complete'].includes(rows[0].phase)) throw new Error('Invalid scene cutover journal');
  return rows[0];
}

function assertConvertedDatabase(db: DatabaseSync): void {
  if (inspectSceneCutover(db).tables.length) throw new Error('Scene conversion left old tables behind');
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Scene conversion broke foreign keys');
  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('Scene conversion failed integrity validation');
  assertSceneTables(db);
  assertSceneHistoryIntegrity(db);
}

/** The production startup must call this before starting any scene or delivery worker. */
export function assertSceneCutoverReady(db: DatabaseSync): void {
  const state = journal(db);
  if (state && state.phase !== 'complete') throw new Error('Finish scene configuration recovery before starting workers');
  if (inspectSceneCutover(db).tables.length) throw new Error('Finish scene data conversion before starting workers');
  assertSceneTables(db);
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Scene startup found broken foreign keys');
  assertSceneHistoryIntegrity(db);
}

/** Resumes only the file/commit boundary, never re-executes the database conversion. */
export async function resumeSceneCutover(db: DatabaseSync, configPath: string): Promise<{ snapshotPath: string; resumed: boolean }> {
  offline(db);
  const state = journal(db);
  if (!state) throw new Error('No scene cutover to resume');
  const config = resolve(configPath);
  if (state.config_path !== config) throw new Error('Scene cutover configuration path mismatch');
  if (!(await lstat(config)).isFile()) throw new Error('Scene configuration must be a regular file');
  const currentHash = digest(await readFile(config));
  if (currentHash !== state.before_hash && currentHash !== state.after_hash) throw new Error('Configuration changed outside scene cutover; reconcile before resuming');
  assertConvertedDatabase(db);
  if (state.phase === 'complete') {
    if (currentHash !== state.after_hash) throw new Error('Completed scene configuration was reverted');
    return { snapshotPath: state.snapshot_path, resumed: false };
  }
  await verifySceneCutoverSnapshot(state.snapshot_path);
  if (currentHash !== state.after_hash) {
    const pendingDirectory = dirname(state.pending_path);
    if (dirname(pendingDirectory) !== dirname(config) || !basename(pendingDirectory).startsWith('.scene-config-cutover-')
      || basename(state.pending_path) !== 'config.json' || !(await lstat(pendingDirectory)).isDirectory()
      || !(await lstat(state.pending_path)).isFile()) throw new Error('Invalid scene pending configuration path');
    if (digest(await readFile(state.pending_path)) !== state.after_hash) throw new Error('Pending scene configuration hash mismatch');
    if (digest(await readFile(config)) !== currentHash) throw new Error('Configuration changed during scene recovery');
    await rename(state.pending_path, config);
  }
  await sync(config);
  await sync(dirname(config), true);
  db.prepare("UPDATE scene_cutover_journal SET phase = 'complete' WHERE version = 1 AND phase = 'db_committed'").run();
  return { snapshotPath: state.snapshot_path, resumed: true };
}

/** Offline release coordinator. The synchronous converter must normalize and reconcile every old table. */
export async function commitSceneCutover(input: {
  db: DatabaseSync;
  configPath: string;
  backupRoot: string;
  bindings?: SceneCutoverBindings;
  checklists?: Array<{ workspaceId: string; sourcePath: string }>;
  convert: (db: DatabaseSync, config: Readonly<Record<string, unknown>>, bindings: SceneCutoverBindings, snapshotPath: string) => undefined;
}): Promise<{ snapshotPath: string; resumed: boolean }> {
  offline(input.db);
  if (journal(input.db)) return resumeSceneCutover(input.db, input.configPath);
  const blockers = inspectSceneCutover(input.db).blockers;
  if (blockers.length) throw new Error(`Scene cutover requires reconciliation: ${blockers.join(', ')}`);
  const bindings = resolveSceneCutoverBindings(input.db, input.bindings ?? []);
  const configPath = resolve(input.configPath);
  if (!(await lstat(configPath)).isFile()) throw new Error('Scene configuration must be a regular file');
  const before = await readFile(configPath);
  const config = JSON.parse(before.toString('utf8')) as Record<string, unknown>;
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Scene configuration must be an object');
  const converted = structuredClone(config);
  if (converted.gateway !== undefined) {
    if (!converted.gateway || typeof converted.gateway !== 'object' || Array.isArray(converted.gateway)) throw new Error('Gateway configuration must be an object');
    delete (converted.gateway as Record<string, unknown>).heartbeat;
  }
  const after = JSON.stringify(converted, null, 2) + '\n';
  const dataVersion = input.db.prepare('PRAGMA data_version').get()?.data_version;
  const snapshot = await createSceneCutoverSnapshot({ db: input.db, backupRoot: input.backupRoot, configPath, checklists: input.checklists });
  const directory = await mkdtemp(join(dirname(configPath), '.scene-config-cutover-'));
  await chmod(directory, 0o700);
  const pending = join(directory, 'config.json');
  await writeFile(pending, after, { flag: 'wx', mode: 0o600 });
  await sync(pending); await sync(directory, true); await sync(dirname(directory), true);
  if (digest(await readFile(configPath)) !== digest(before)) throw new Error('Configuration changed before scene cutover');
  input.db.exec('BEGIN EXCLUSIVE');
  try {
    if (input.db.prepare('PRAGMA data_version').get()?.data_version !== dataVersion) throw new Error('Database changed after the scene snapshot');
    const currentBlockers = inspectSceneCutover(input.db).blockers;
    if (currentBlockers.length) throw new Error(`Scene cutover requires reconciliation: ${currentBlockers.join(', ')}`);
    resolveSceneCutoverBindings(input.db, bindings);
    if (input.convert(input.db, config, bindings, snapshot.directory) !== undefined) throw new Error('Scene database conversion must be synchronous');
    assertConvertedDatabase(input.db);
    input.db.exec(readSqliteAsset('migrations/scenes/journal.sql'));
    input.db.prepare("INSERT INTO scene_cutover_journal VALUES (1, 'db_committed', ?, ?, ?, ?, ?)")
      .run(configPath, pending, digest(before), digest(after), snapshot.directory);
    input.db.exec('COMMIT');
  } catch (error) {
    input.db.exec('ROLLBACK');
    throw error;
  }
  return resumeSceneCutover(input.db, configPath);
}
