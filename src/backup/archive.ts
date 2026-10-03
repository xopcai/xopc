import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { requireNodeSqlite } from '../infra/node-sqlite.js';
import { assertDatabaseOffline } from '../storage/sqlite/migrations/conversation-backup.js';
import { expandWorkspacePathString } from '../config/workspace-path.js';

const FORMAT = 'xopc-state-backup';
const VERSION = 1;
const OMIT_TOP_LEVEL = new Set(['logs', 'cache', 'tools']);
const OMIT_FILES = new Set(['pid', 'status.json', 'agent.sock', 'update.lock']);
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;

type Entry = {
  path: string;
  blob: string;
  bytes: number;
  sha256: string;
  nonce: string;
  tag: string;
  mode: number;
};

type Manifest = {
  format: typeof FORMAT;
  version: typeof VERSION;
  createdAt: string;
  schemaVersion: number;
  entries: Entry[];
  excluded: string[];
};

type Header = {
  format: typeof FORMAT;
  version: typeof VERSION;
  salt: string;
  manifestNonce: string;
  manifestTag: string;
};

function inside(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function safeRelativePath(value: string): string {
  if (!value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`Unsafe backup path: ${value}`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe backup path: ${value}`);
  }
  return value;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 12) throw new Error('Backup passphrase must have at least 12 characters');
  return scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function encryptBytes(plain: Buffer, key: Buffer): { data: Buffer; nonce: string; tag: string } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  return { data: Buffer.concat([cipher.update(plain), cipher.final()]), nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

function decryptBytes(ciphertext: Buffer, key: Buffer, nonce: string, tag: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function collectFiles(root: string): Promise<{ files: string[]; excluded: string[] }> {
  const files: string[] = [];
  const excluded: string[] = [];
  async function walk(directory: string, prefix = ''): Promise<void> {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (!prefix && (OMIT_TOP_LEVEL.has(item.name) || OMIT_FILES.has(item.name))) {
        excluded.push(rel);
        continue;
      }
      if (!prefix && /^xopc\.db(?:-wal|-shm|-journal)?$/.test(item.name)) {
        if (item.name !== 'xopc.db') excluded.push(rel);
        continue;
      }
      const source = join(directory, item.name);
      if (item.isSymbolicLink()) throw new Error(`Backup contains a symbolic link: ${rel}`);
      if (item.isDirectory()) await walk(source, rel);
      else if (item.isFile()) files.push(rel);
      else throw new Error(`Backup contains an unsupported file type: ${rel}`);
    }
  }
  await walk(root);
  return { files, excluded };
}

async function encryptFile(source: string, destination: string, key: Buffer, path: string): Promise<Entry> {
  const handle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`Backup entry is not a regular file: ${path}`);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const digest = createHash('sha256');
    let bytes = 0;
    const hashStream = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      digest.update(chunk);
      callback(null, chunk);
    } });
    await pipeline(handle.createReadStream({ autoClose: false }), hashStream, cipher, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
    const after = await handle.stat();
    const current = await lstat(source);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes !== before.size || !current.isFile() || before.ino !== current.ino || before.dev !== current.dev) {
      throw new Error(`File changed during backup: ${path}`);
    }
    return { path, blob: basename(destination), bytes, sha256: digest.digest('hex'), nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), mode: before.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

async function readArchive(archivePath: string, passphrase: string): Promise<{ manifest: Manifest; key: Buffer }> {
  const rawHeader = await readFile(join(archivePath, 'header.json'), 'utf8');
  const header = JSON.parse(rawHeader) as Header;
  if (header.format !== FORMAT || header.version !== VERSION) throw new Error('Unsupported backup format');
  const key = deriveKey(passphrase, Buffer.from(header.salt, 'base64'));
  const encrypted = await readFile(join(archivePath, 'manifest.enc'));
  if (encrypted.length > MAX_MANIFEST_BYTES) throw new Error('Backup manifest is too large');
  const manifest = JSON.parse(decryptBytes(encrypted, key, header.manifestNonce, header.manifestTag).toString('utf8')) as Manifest;
  if (manifest.format !== FORMAT || manifest.version !== VERSION || !Array.isArray(manifest.entries)) throw new Error('Invalid backup manifest');
  const seen = new Set<string>();
  for (const entry of manifest.entries) {
    safeRelativePath(entry.path);
    if (!/^[0-9a-f-]{36}\.enc$/.test(entry.blob) || seen.has(entry.path)) throw new Error('Invalid backup entry');
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('Invalid backup entry metadata');
    seen.add(entry.path);
  }
  return { manifest, key };
}

async function decryptEntry(archivePath: string, entry: Entry, key: Buffer, destination?: string): Promise<void> {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
  const hash = createHash('sha256');
  let bytes = 0;
  const check = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    hash.update(chunk);
    callback(null, chunk);
  } });
  const sink = destination ? createWriteStream(destination, { flags: 'wx', mode: 0o600 }) : new Transform({ transform(_chunk, _encoding, callback) { callback(); } });
  await pipeline(createReadStream(join(archivePath, 'blobs', entry.blob)), decipher, check, sink);
  if (bytes !== entry.bytes || hash.digest('hex') !== entry.sha256) throw new Error(`Backup checksum mismatch: ${entry.path}`);
}

export async function createStateBackup(input: { stateDir: string; output: string; passphrase: string; configPath?: string; configuredPaths?: string[] }): Promise<Manifest> {
  const root = resolve(input.stateDir);
  const output = resolve(input.output);
  if (inside(output, root)) throw new Error('Backup output must be outside the state directory');
  if (!(await lstat(root)).isDirectory()) throw new Error('State path is not a directory');
  const databasePath = join(root, 'xopc.db');
  if (!(await lstat(databasePath)).isFile()) throw new Error('State database not found');
  assertDatabaseOffline(databasePath);
  const { DatabaseSync, backup } = requireNodeSqlite();
  const pathDb = new DatabaseSync(databasePath, { readOnly: true });
  const configuredPaths = [...(input.configuredPaths ?? [])];
  const configPath = resolve(input.configPath ?? join(root, 'xopc.json'));
  try {
    if (inside(configPath, root)) {
      const config = JSON.parse(await readFile(configPath, 'utf8')) as { agents?: { list?: Array<{ workspace?: string }> } };
      if (Array.isArray(config.agents?.list)) {
        configuredPaths.push(...config.agents.list.map((agent) => agent.workspace).filter((path): path is string => typeof path === 'string'));
      }
    }
    const hasAgents = pathDb.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='agents'").get();
    if (hasAgents) {
      const rows = pathDb.prepare('SELECT workspace_override FROM agents WHERE deleted_at IS NULL AND workspace_override IS NOT NULL').all() as Array<{ workspace_override: string }>;
      configuredPaths.push(...rows.map((row) => row.workspace_override));
    }
  } finally { pathDb.close(); }
  const external = [...new Set(configuredPaths.map((path) => resolve(expandWorkspacePathString(path))).filter((path) => !inside(path, root)))];
  if (external.length) throw new Error(`External paths are not included in this backup: ${external.join(', ')}`);
  const { files, excluded } = await collectFiles(root);
  const salt = randomBytes(32);
  const key = deriveKey(input.passphrase, salt);
  const scratch = await mkdtemp(join(tmpdir(), 'xopc-backup-'));
  let archiveCreated = false;
  try {
    await mkdir(output, { mode: 0o700 });
    archiveCreated = true;
    await mkdir(join(output, 'blobs'), { mode: 0o700 });
    const snapshot = join(scratch, 'xopc.db');
    const source = new DatabaseSync(databasePath, { readOnly: true });
    try { await backup(source, snapshot); } finally { source.close(); }
    const checked = new DatabaseSync(snapshot, { readOnly: true });
    let schemaVersion = 0;
    try {
      if ((checked.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check !== 'ok') throw new Error('Database snapshot failed integrity check');
      schemaVersion = Number((checked.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get() as { value?: string } | undefined)?.value ?? 0);
    } finally { checked.close(); }
    const entries: Entry[] = [];
    for (const rel of ['xopc.db', ...files]) {
      const sourcePath = rel === 'xopc.db' ? snapshot : join(root, rel);
      const blob = `${randomUUID()}.enc`;
      entries.push(await encryptFile(sourcePath, join(output, 'blobs', blob), key, rel));
    }
    const manifest: Manifest = { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), schemaVersion, entries, excluded };
    const sealed = encryptBytes(Buffer.from(JSON.stringify(manifest)), key);
    if (sealed.data.length > MAX_MANIFEST_BYTES) throw new Error('Backup manifest is too large');
    await writeFile(join(output, 'manifest.enc'), sealed.data, { flag: 'wx', mode: 0o600 });
    const header: Header = { format: FORMAT, version: VERSION, salt: salt.toString('base64'), manifestNonce: sealed.nonce, manifestTag: sealed.tag };
    await writeFile(join(output, 'header.json'), `${JSON.stringify(header)}\n`, { flag: 'wx', mode: 0o600 });
    return manifest;
  } catch (error) {
    if (archiveCreated) await rm(output, { recursive: true, force: true });
    throw error;
  } finally {
    key.fill(0);
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function verifyStateBackup(archivePath: string, passphrase: string): Promise<Manifest> {
  const archive = resolve(archivePath);
  const { manifest, key } = await readArchive(archive, passphrase);
  const scratch = await mkdtemp(join(tmpdir(), 'xopc-backup-verify-'));
  try {
    for (const entry of manifest.entries) await decryptEntry(archive, entry, key, entry.path === 'xopc.db' ? join(scratch, 'xopc.db') : undefined);
    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(join(scratch, 'xopc.db'), { readOnly: true });
    try {
      if ((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check !== 'ok') throw new Error('Backup database failed integrity check');
    } finally { db.close(); }
    return manifest;
  } finally { key.fill(0); await rm(scratch, { recursive: true, force: true }); }
}

export async function restoreStateBackup(input: { archivePath: string; target: string; passphrase: string }): Promise<Manifest> {
  const archive = resolve(input.archivePath);
  const target = resolve(input.target);
  const { manifest, key } = await readArchive(archive, input.passphrase);
  const parent = dirname(target);
  let staging: string | undefined;
  try {
    await mkdir(parent, { recursive: true });
    try {
      await lstat(target);
      throw new Error('Restore target already exists; choose a new directory');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    staging = await mkdtemp(join(parent, `.xopc-restore-${randomUUID()}-`));
    for (const entry of manifest.entries) {
      const destination = join(staging, ...entry.path.split('/'));
      if (!inside(destination, staging)) throw new Error('Backup path escapes target');
      await mkdir(dirname(destination), { recursive: true });
      await decryptEntry(archive, entry, key, destination);
      await chmod(destination, entry.mode & 0o777);
    }
    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(join(staging, 'xopc.db'), { readOnly: true });
    try {
      if ((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check !== 'ok') throw new Error('Restored database failed integrity check');
    } finally { db.close(); }
    await rename(staging, target);
    return manifest;
  } catch (error) {
    if (staging) await rm(staging, { recursive: true, force: true });
    throw error;
  } finally { key.fill(0); }
}
