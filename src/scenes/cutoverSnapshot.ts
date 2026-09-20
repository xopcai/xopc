import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { inspectSceneCutover } from './cutoverPreflight.js';

const fileHash = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z.strictObject({
  version: z.literal(1),
  createdAt: z.string().datetime(),
  databaseHash: fileHash,
  configHash: fileHash.nullable(),
});
export type SceneSnapshotManifest = z.infer<typeof manifestSchema>;

async function digest(path: string): Promise<string> {
  if (!(await lstat(path)).isFile()) throw new Error('Snapshot asset must be a regular file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function flush(path: string, directory = false): Promise<void> {
  if (directory && process.platform === 'win32') return;
  const handle = await open(path, directory ? 'r' : 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
}

function inspectDatabase(path: string): ReturnType<typeof inspectSceneCutover> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('Snapshot database integrity check failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Snapshot contains broken foreign keys');
    return inspectSceneCutover(db);
  } finally { db.close(); }
}

/** Preparation only: consistent SQLite backup, private config copy, no source writes. */
export async function createSceneCutoverSnapshot(input: {
  db: DatabaseSync; backupRoot: string; configPath?: string;
}): Promise<{ directory: string; manifest: SceneSnapshotManifest; report: ReturnType<typeof inspectSceneCutover> }> {
  const before = input.configPath ? await readFile(input.configPath) : null;
  if (before) JSON.parse(before.toString('utf8'));
  const directory = await mkdtemp(join(resolve(input.backupRoot), 'scene-cutover-'));
  await chmod(directory, 0o700);
  const databasePath = join(directory, 'xopc.db');
  // VACUUM INTO includes committed WAL contents; copying the main file alone does not.
  input.db.exec(`VACUUM INTO '${databasePath.replaceAll("'", "''")}'`);
  await chmod(databasePath, 0o600);
  await flush(databasePath);
  const report = inspectDatabase(databasePath);
  if (input.configPath && !before!.equals(await readFile(input.configPath))) throw new Error('Configuration changed while preparing the snapshot');
  let configHash: string | null = null;
  if (before) {
    const configPath = join(directory, 'xopc.json');
    await writeFile(configPath, before, { flag: 'wx', mode: 0o600 });
    await flush(configPath);
    configHash = await digest(configPath);
  }
  const manifest: SceneSnapshotManifest = { version: 1, createdAt: new Date().toISOString(), databaseHash: await digest(databasePath), configHash };
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  await flush(manifestPath);
  await flush(directory, true);
  await flush(dirname(directory), true);
  return { directory, manifest, report };
}

export async function verifySceneCutoverSnapshot(directory: string): Promise<SceneSnapshotManifest> {
  const root = resolve(directory);
  if (!(await lstat(root)).isDirectory()) throw new Error('Snapshot must be a directory');
  const manifestPath = join(root, 'manifest.json');
  if (!(await lstat(manifestPath)).isFile()) throw new Error('Snapshot manifest must be a regular file');
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (await digest(join(root, 'xopc.db')) !== manifest.databaseHash) throw new Error('Snapshot database hash mismatch');
  if (manifest.configHash !== null) {
    if (await digest(join(root, 'xopc.json')) !== manifest.configHash) throw new Error('Snapshot configuration hash mismatch');
    JSON.parse(await readFile(join(root, 'xopc.json'), 'utf8'));
  }
  inspectDatabase(join(root, 'xopc.db'));
  return manifest;
}

/** Restores only to a new directory; cannot overwrite a live or existing installation. */
export async function restoreSceneCutoverSnapshot(directory: string, destination: string): Promise<void> {
  const manifest = await verifySceneCutoverSnapshot(directory);
  const target = resolve(destination);
  await mkdir(target, { mode: 0o700 });
  for (const name of ['xopc.db', ...(manifest.configHash === null ? [] : ['xopc.json'])]) {
    const path = join(target, name);
    await copyFile(join(resolve(directory), name), path, constants.COPYFILE_EXCL);
    await chmod(path, 0o600);
    await flush(path);
  }
  // Detect concurrent replacement of snapshot files during the copy, before marking ready.
  if (await digest(join(target, 'xopc.db')) !== manifest.databaseHash
    || (manifest.configHash !== null && await digest(join(target, 'xopc.json')) !== manifest.configHash)) throw new Error('Snapshot changed during restoration');
  inspectDatabase(join(target, 'xopc.db'));
  await flush(target, true);
  await flush(dirname(target), true);
}
