import { createHash } from 'node:crypto';
import { constants, createReadStream, lstatSync, readFileSync } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { inspectSceneCutover } from './preflight.js';
import type { SceneChecklistImport } from './heartbeat.js';

const fileHash = z.string().regex(/^[a-f0-9]{64}$/);
const checklistAssets = z.array(z.strictObject({
  workspaceId: z.string().min(1), sourcePath: z.string().min(1),
  file: z.string().regex(/^checklist-[0-9]+\.md$/), hash: fileHash.nullable(),
})).max(10_000).refine((rows) => new Set(rows.map((row) => row.workspaceId)).size === rows.length
  && new Set(rows.map((row) => row.file)).size === rows.length, 'Duplicate checklist asset');
const manifestSchema = z.strictObject({
  version: z.literal(1),
  createdAt: z.string().datetime(),
  databaseHash: fileHash,
  configHash: fileHash.nullable(),
  checklists: checklistAssets.optional(),
});
export type SceneSnapshotManifest = z.infer<typeof manifestSchema>;

/** Reads the backed-up bytes and refuses a concurrent edit before committing the import. */
export function readSceneSnapshotChecklists(directory: string): SceneChecklistImport[] {
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')));
  return (manifest.checklists ?? []).map((asset) => {
    let current: Buffer | null = null;
    try {
      if (!lstatSync(asset.sourcePath).isFile()) throw new Error('Checklist must be a regular file');
      current = readFileSync(asset.sourcePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if ((current === null ? null : createHash('sha256').update(current).digest('hex')) !== asset.hash) {
      throw new Error('Checklist changed after the scene snapshot');
    }
    const content = asset.hash === null ? null : readFileSync(join(directory, asset.file));
    if (content !== null && createHash('sha256').update(content).digest('hex') !== asset.hash) throw new Error('Snapshot checklist hash mismatch');
    return { workspaceId: asset.workspaceId, sourcePath: asset.sourcePath,
      content: content === null ? null : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content) };
  });
}

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
  checklists?: Array<{ workspaceId: string; sourcePath: string }>;
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
  if (input.checklists) {
    manifest.checklists = checklistAssets.parse(input.checklists.map((row, index) => ({
      workspaceId: row.workspaceId, sourcePath: resolve(row.sourcePath), file: `checklist-${index}.md`, hash: null,
    })));
    for (const asset of manifest.checklists) {
      let content: Buffer;
      try {
        if (!(await lstat(asset.sourcePath)).isFile()) throw new Error('Checklist must be a regular file');
        content = await readFile(asset.sourcePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      // Reject invalid UTF-8 instead of silently replacing private instruction bytes.
      new TextDecoder('utf-8', { fatal: true }).decode(content);
      await writeFile(join(directory, asset.file), content, { flag: 'wx', mode: 0o600 });
      await flush(join(directory, asset.file));
      asset.hash = createHash('sha256').update(content).digest('hex');
    }
  }
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
  for (const asset of manifest.checklists ?? []) {
    if (asset.hash !== null && await digest(join(root, asset.file)) !== asset.hash) throw new Error('Snapshot checklist hash mismatch');
  }
  inspectDatabase(join(root, 'xopc.db'));
  return manifest;
}

/** Restores only to a new directory; cannot overwrite a live or existing installation. */
export async function restoreSceneCutoverSnapshot(directory: string, destination: string): Promise<void> {
  const manifest = await verifySceneCutoverSnapshot(directory);
  const target = resolve(destination);
  await mkdir(target, { mode: 0o700 });
  for (const name of ['manifest.json', 'xopc.db', ...(manifest.configHash === null ? [] : ['xopc.json']),
    ...(manifest.checklists ?? []).filter((asset) => asset.hash !== null).map((asset) => asset.file)]) {
    const path = join(target, name);
    await copyFile(join(resolve(directory), name), path, constants.COPYFILE_EXCL);
    await chmod(path, 0o600);
    await flush(path);
  }
  // Detect concurrent replacement of snapshot files during the copy, before marking ready.
  if (await digest(join(target, 'xopc.db')) !== manifest.databaseHash
    || (manifest.configHash !== null && await digest(join(target, 'xopc.json')) !== manifest.configHash)) throw new Error('Snapshot changed during restoration');
  for (const asset of manifest.checklists ?? []) {
    if (asset.hash !== null && await digest(join(target, asset.file)) !== asset.hash) throw new Error('Snapshot checklist changed during restoration');
  }
  inspectDatabase(join(target, 'xopc.db'));
  await flush(target, true);
  await flush(dirname(target), true);
}
