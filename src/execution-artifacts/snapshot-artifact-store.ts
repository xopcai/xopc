import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';

import { runExec } from '../infra/exec.js';

const ARTIFACT_ID = /^[a-zA-Z0-9._-]+$/;
const MAGIC = Buffer.from('XOPCSN01');
const MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
export const SNAPSHOT_CHUNK_BYTES = 96 * 1024;

async function runGit(rootPath: string, args: string[]): Promise<string> {
  return (await runExec('git', ['-C', rootPath, ...args], {
    timeoutMs: 2 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  })).stdout;
}

type SnapshotEntry = {
  path: string;
  type: 'file' | 'symlink' | 'deleted';
  mode: number;
  size: number;
  offset: number;
  linkTarget?: string;
};

type SnapshotManifest = {
  version: 1;
  baseSha: string;
  entries: SnapshotEntry[];
};

export interface SnapshotArtifact {
  artifactId: string;
  baseSha: string;
  size: number;
  sha256: string;
}

type ArtifactRecord = SnapshotArtifact & { status: 'ready' | 'receiving' };

function safeArtifactId(value: string): string {
  const id = value.trim();
  if (!id || !ARTIFACT_ID.test(id) || id === '.' || id === '..') {
    throw new Error('Snapshot artifact id is invalid');
  }
  return id;
}

function safeRelativePath(rootPath: string, value: string): string {
  if (
    !value
    || isAbsolute(value)
    || value.includes('\0')
    || value.includes('\\')
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) throw new Error('Snapshot path is invalid');
  const target = resolve(rootPath, value);
  const child = relative(resolve(rootPath), target);
  const firstSegment = child.split(/[\\/]/, 1)[0];
  if (!child || child.startsWith('..') || resolve(rootPath, child) !== target || firstSegment.toLowerCase() === '.git') {
    throw new Error(`Snapshot path escapes the worktree: ${value}`);
  }
  return target;
}

async function assertNoSymlinkAncestor(rootPath: string, value: string): Promise<void> {
  const segments = value.split('/');
  let current = resolve(rootPath);
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    const info = await lstat(current).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (info?.isSymbolicLink()) throw new Error(`Snapshot path traverses an existing symlink: ${value}`);
  }
}

class ByteLimitTransform extends Transform {
  private total = 0;

  constructor(private readonly limit: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.total += chunk.length;
    if (this.total > this.limit) {
      callback(new Error('Decompressed snapshot exceeds the configured size limit'));
      return;
    }
    callback(null, chunk);
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function writeAll(file: Awaited<ReturnType<typeof open>>, buffer: Buffer): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const written = await file.write(buffer, offset, buffer.length - offset, null);
    offset += written.bytesWritten;
  }
}

async function readExact(
  file: Awaited<ReturnType<typeof open>>,
  length: number,
  position: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const read = await file.read(buffer, offset, length - offset, position + offset);
    if (read.bytesRead === 0) throw new Error('Snapshot artifact ended unexpectedly');
    offset += read.bytesRead;
  }
  return buffer;
}

export class SnapshotArtifactStore {
  private readonly root: string;

  constructor(stateDir: string) {
    this.root = join(stateDir, 'snapshot-artifacts');
  }

  async create(input: {
    artifactId: string;
    rootPath: string;
    baseSha: string;
  }): Promise<SnapshotArtifact> {
    const artifactId = safeArtifactId(input.artifactId);
    const existing = await this.readRecord(artifactId);
    if (existing?.status === 'ready') return existing;
    const headSha = (await runGit(input.rootPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    if (headSha !== input.baseSha) throw new Error('Snapshot worktree HEAD does not match its handoff base');
    const paths = [...new Set([
      ...(await runGit(input.rootPath, ['diff', '--name-only', '-z', 'HEAD', '--'])).split('\0'),
      ...(await runGit(input.rootPath, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0'),
    ].filter(Boolean))].sort();
    if (paths.length > 100_000) throw new Error('Snapshot contains too many files');
    const entries: SnapshotEntry[] = [];
    let dataBytes = 0;
    for (const path of paths) {
      const absolutePath = safeRelativePath(input.rootPath, path);
      const info = await lstat(absolutePath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      });
      if (!info) {
        entries.push({ path, type: 'deleted', mode: 0, size: 0, offset: dataBytes });
        continue;
      }
      if (info.isDirectory()) throw new Error(`Snapshot does not support Git submodules: ${path}`);
      if (!info.isFile() && !info.isSymbolicLink()) throw new Error(`Snapshot file type is unsupported: ${path}`);
      const size = info.isSymbolicLink() ? 0 : info.size;
      dataBytes += size;
      if (dataBytes > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot content exceeds 128 MB');
      entries.push({
        path,
        type: info.isSymbolicLink() ? 'symlink' : 'file',
        mode: info.mode & 0o777,
        size,
        offset: dataBytes - size,
        ...(info.isSymbolicLink() ? { linkTarget: await readlink(absolutePath) } : {}),
      });
    }
    const manifest: SnapshotManifest = { version: 1, baseSha: input.baseSha, entries };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    if (manifestBytes.length > MAX_MANIFEST_BYTES) throw new Error('Snapshot manifest exceeds 8 MB');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const rawPath = join(this.root, `${artifactId}.${crypto.randomUUID()}.raw`);
    const temporary = join(this.root, `${artifactId}.${crypto.randomUUID()}.gz.tmp`);
    const raw = await open(rawPath, 'wx', 0o600);
    try {
      const header = Buffer.alloc(12);
      MAGIC.copy(header, 0);
      header.writeUInt32BE(manifestBytes.length, 8);
      await writeAll(raw, header);
      await writeAll(raw, manifestBytes);
      for (const entry of entries) {
        if (entry.type !== 'file') continue;
        for await (const chunk of createReadStream(safeRelativePath(input.rootPath, entry.path))) {
          await writeAll(raw, chunk as Buffer);
        }
      }
    } finally {
      await raw.close();
    }
    try {
      if ((await stat(rawPath)).size !== 12 + manifestBytes.length + dataBytes) {
        throw new Error('Snapshot source changed while the artifact was being captured');
      }
      await pipeline(createReadStream(rawPath), createGzip({ level: 6 }), createWriteStream(temporary, { mode: 0o600, flags: 'wx' }));
      const size = (await stat(temporary)).size;
      if (size > MAX_SNAPSHOT_BYTES) throw new Error('Compressed snapshot exceeds 128 MB');
      const artifact: SnapshotArtifact = {
        artifactId,
        baseSha: input.baseSha,
        size,
        sha256: await sha256File(temporary),
      };
      await rename(temporary, this.artifactPath(artifactId));
      await this.writeRecord({ ...artifact, status: 'ready' });
      return artifact;
    } finally {
      await rm(rawPath, { force: true });
      await rm(temporary, { force: true });
    }
  }

  async beginReceive(artifact: SnapshotArtifact): Promise<boolean> {
    const artifactId = safeArtifactId(artifact.artifactId);
    if (!Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > MAX_SNAPSHOT_BYTES) {
      throw new Error('Snapshot artifact size is invalid');
    }
    if (!/^[0-9a-f]{64}$/i.test(artifact.sha256)) throw new Error('Snapshot artifact SHA-256 is invalid');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const existing = await this.readRecord(artifactId);
    if (
      existing?.status === 'ready'
      && existing.size === artifact.size
      && existing.sha256 === artifact.sha256
      && existing.baseSha === artifact.baseSha
    ) return true;
    await rm(this.partialPath(artifactId), { force: true });
    const file = await open(this.partialPath(artifactId), 'wx', 0o600);
    await file.close();
    await this.writeRecord({ ...artifact, artifactId, status: 'receiving' });
    return false;
  }

  async writeChunk(artifactIdValue: string, offset: number, data: Buffer): Promise<void> {
    const artifactId = safeArtifactId(artifactIdValue);
    if (!Number.isSafeInteger(offset) || offset < 0 || data.length > SNAPSHOT_CHUNK_BYTES) {
      throw new Error('Snapshot chunk is invalid');
    }
    const record = await this.requireRecord(artifactId);
    const partialPath = this.partialPath(artifactId);
    const currentSize = (await stat(partialPath)).size;
    if (currentSize === offset) {
      if (currentSize + data.length > record.size) throw new Error('Snapshot chunk exceeds declared size');
      const file = await open(partialPath, 'a', 0o600);
      try {
        await writeAll(file, data);
      } finally {
        await file.close();
      }
      return;
    }
    if (currentSize >= offset + data.length) {
      const file = await open(partialPath, 'r');
      try {
        const existing = await readExact(file, data.length, offset);
        if (existing.equals(data)) return;
      } finally {
        await file.close();
      }
    }
    throw new Error('Snapshot chunks must be written sequentially');
  }

  async finalizeReceive(artifactIdValue: string): Promise<SnapshotArtifact> {
    const artifactId = safeArtifactId(artifactIdValue);
    const record = await this.requireRecord(artifactId);
    if (record.status === 'ready') return record;
    const partialPath = this.partialPath(artifactId);
    if ((await stat(partialPath)).size !== record.size) throw new Error('Snapshot artifact is incomplete');
    if (await sha256File(partialPath) !== record.sha256) throw new Error('Snapshot artifact checksum mismatch');
    await rename(partialPath, this.artifactPath(artifactId));
    const ready: ArtifactRecord = { ...record, status: 'ready' };
    await this.writeRecord(ready);
    return ready;
  }

  async readChunk(artifactIdValue: string, offset: number, length: number): Promise<{
    offset: number;
    data: Buffer;
    eof: boolean;
  }> {
    const artifactId = safeArtifactId(artifactIdValue);
    const record = await this.requireRecord(artifactId);
    if (record.status !== 'ready') throw new Error('Snapshot artifact is not ready');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > record.size) throw new Error('Snapshot offset is invalid');
    const boundedLength = Math.min(SNAPSHOT_CHUNK_BYTES, Math.max(1, Math.floor(length)));
    const size = Math.min(boundedLength, record.size - offset);
    const file = await open(this.artifactPath(artifactId), 'r');
    try {
      const data = size > 0 ? await readExact(file, size, offset) : Buffer.alloc(0);
      return { offset, data, eof: offset + size === record.size };
    } finally {
      await file.close();
    }
  }

  async apply(input: { artifactId: string; rootPath: string; baseSha: string }): Promise<void> {
    const artifactId = safeArtifactId(input.artifactId);
    const record = await this.requireRecord(artifactId);
    if (record.status !== 'ready' || record.baseSha !== input.baseSha) {
      throw new Error('Snapshot artifact base does not match the target environment');
    }
    if (await sha256File(this.artifactPath(artifactId)) !== record.sha256) {
      throw new Error('Snapshot artifact checksum mismatch');
    }
    const headSha = (await runGit(input.rootPath, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    if (headSha !== input.baseSha) throw new Error('Snapshot target HEAD does not match the artifact base');
    const rawPath = join(this.root, `${artifactId}.${crypto.randomUUID()}.apply.raw`);
    try {
      await pipeline(
        createReadStream(this.artifactPath(artifactId)),
        createGunzip(),
        new ByteLimitTransform(MAX_SNAPSHOT_BYTES + MAX_MANIFEST_BYTES + 12),
        createWriteStream(rawPath, { mode: 0o600, flags: 'wx' }),
      );
      const raw = await open(rawPath, 'r');
      try {
        const header = await readExact(raw, 12, 0);
        if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('Snapshot artifact format is invalid');
        const manifestLength = header.readUInt32BE(8);
        if (manifestLength < 1 || manifestLength > MAX_MANIFEST_BYTES) throw new Error('Snapshot manifest size is invalid');
        const manifest = JSON.parse((await readExact(raw, manifestLength, 12)).toString('utf8')) as SnapshotManifest;
        this.validateManifest(manifest, input.rootPath, input.baseSha, (await stat(rawPath)).size - 12 - manifestLength);
        const dataStart = 12 + manifestLength;
        const deletions = manifest.entries
          .filter((entry) => entry.type === 'deleted')
          .sort((left, right) => left.path.split('/').length - right.path.split('/').length);
        for (const entry of deletions) {
          await assertNoSymlinkAncestor(input.rootPath, entry.path);
          await rm(safeRelativePath(input.rootPath, entry.path), { recursive: true, force: true });
        }
        for (const entry of manifest.entries.filter((candidate) => candidate.type !== 'deleted')) {
          const target = safeRelativePath(input.rootPath, entry.path);
          await assertNoSymlinkAncestor(input.rootPath, entry.path);
          await rm(target, { recursive: true, force: true });
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          if (entry.type === 'symlink') {
            await symlink(entry.linkTarget!, target);
            continue;
          }
          const output = await open(target, 'wx', entry.mode || 0o600);
          try {
            let copied = 0;
            while (copied < entry.size) {
              const chunkSize = Math.min(64 * 1024, entry.size - copied);
              await writeAll(output, await readExact(raw, chunkSize, dataStart + entry.offset + copied));
              copied += chunkSize;
            }
          } finally {
            await output.close();
          }
          await chmod(target, entry.mode);
        }
      } finally {
        await raw.close();
      }
    } finally {
      await rm(rawPath, { force: true });
    }
  }

  async remove(artifactIdValue: string): Promise<void> {
    const artifactId = safeArtifactId(artifactIdValue);
    await Promise.all([
      rm(this.artifactPath(artifactId), { force: true }),
      rm(this.partialPath(artifactId), { force: true }),
      rm(this.recordPath(artifactId), { force: true }),
    ]);
  }

  private validateManifest(manifest: SnapshotManifest, rootPath: string, baseSha: string, dataBytes: number): void {
    if (manifest.version !== 1 || manifest.baseSha !== baseSha || !Array.isArray(manifest.entries)) {
      throw new Error('Snapshot manifest is incompatible');
    }
    if (manifest.entries.length > 100_000) throw new Error('Snapshot contains too many files');
    const seen = new Set<string>();
    const symlinkPaths = new Set<string>();
    let expectedOffset = 0;
    for (const entry of manifest.entries) {
      safeRelativePath(rootPath, entry.path);
      if (seen.has(entry.path)) throw new Error(`Snapshot contains a duplicate path: ${entry.path}`);
      seen.add(entry.path);
      if (entry.type !== 'file' && entry.type !== 'symlink' && entry.type !== 'deleted') {
        throw new Error('Snapshot entry type is invalid');
      }
      if (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) {
        throw new Error('Snapshot entry mode is invalid');
      }
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.offset !== expectedOffset) {
        throw new Error('Snapshot entry bounds are invalid');
      }
      if (entry.type === 'symlink' && (entry.size !== 0 || typeof entry.linkTarget !== 'string')) {
        throw new Error('Snapshot symlink is invalid');
      }
      if (entry.type === 'deleted' && (entry.size !== 0 || entry.mode !== 0)) {
        throw new Error('Snapshot deletion entry is invalid');
      }
      if (entry.type === 'symlink') symlinkPaths.add(entry.path);
      expectedOffset += entry.size;
      if (expectedOffset > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot content exceeds 128 MB');
    }
    for (const entry of manifest.entries) {
      const segments = entry.path.split('/');
      for (let index = 1; index < segments.length; index += 1) {
        if (symlinkPaths.has(segments.slice(0, index).join('/'))) {
          throw new Error(`Snapshot path traverses a symlink: ${entry.path}`);
        }
      }
    }
    if (expectedOffset !== dataBytes) throw new Error('Snapshot artifact data length is invalid');
  }

  private artifactPath(id: string): string {
    return join(this.root, `${safeArtifactId(id)}.snapshot.gz`);
  }

  private partialPath(id: string): string {
    return join(this.root, `${safeArtifactId(id)}.upload.part`);
  }

  private recordPath(id: string): string {
    return join(this.root, `${safeArtifactId(id)}.json`);
  }

  private async readRecord(id: string): Promise<ArtifactRecord | undefined> {
    try {
      return JSON.parse(await readFile(this.recordPath(id), 'utf8')) as ArtifactRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async requireRecord(id: string): Promise<ArtifactRecord> {
    const record = await this.readRecord(id);
    if (!record) throw new Error(`Snapshot artifact not found: ${id}`);
    return record;
  }

  private async writeRecord(record: ArtifactRecord): Promise<void> {
    const path = this.recordPath(record.artifactId);
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  }
}
