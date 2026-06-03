import { createReadStream } from 'node:fs';
import { stat, readdir, lstat, realpath } from 'node:fs/promises';
import { resolve as resolvePath, relative as relPathPosix } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline as pipelineAsync } from 'node:stream/promises';
import { createDeflateRaw, crc32 } from 'node:zlib';

import { isPathUnderWorkspace } from '../gateway/workspace-editor-path.js';
import type { ShareRecord } from './share-types.js';

// ── Minimal streaming ZIP encoder (ZIP64-aware) ───────────────────────────────
//
// Reference: PKWARE APPNOTE 6.3 §4 and §4.5 (ZIP64 extra field).
// Uses local headers with `FLAG_USE_DATA_DESCRIPTOR` so we can stream entries
// without seeking back to patch sizes once the file is fully read.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_DATA_DESCRIPTOR = 0x08074b50;
const ZIP64_THRESHOLD = 0xffffffff;
const COUNT_ZIP64_THRESHOLD = 0xffff;

const FLAG_USE_DATA_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

interface CentralEntry {
  name: Buffer;
  mtime: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
  method: number;
}

function dosTime(d: Date): number {
  return (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
}

function dosDate(d: Date): number {
  return ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
}

function localFileHeader(name: Buffer, mtimeDate: Date, method: number): Buffer {
  const buf = Buffer.alloc(30 + name.length);
  buf.writeUInt32LE(SIG_LOCAL, 0);
  buf.writeUInt16LE(45, 4); // version needed (4.5 for ZIP64)
  buf.writeUInt16LE(FLAG_USE_DATA_DESCRIPTOR | FLAG_UTF8, 6);
  buf.writeUInt16LE(method, 8);
  buf.writeUInt16LE(dosTime(mtimeDate), 10);
  buf.writeUInt16LE(dosDate(mtimeDate), 12);
  buf.writeUInt32LE(0, 14); // crc — filled in via data descriptor
  buf.writeUInt32LE(0, 18); // compressed size — filled in via data descriptor
  buf.writeUInt32LE(0, 22); // uncompressed size — filled in via data descriptor
  buf.writeUInt16LE(name.length, 26);
  buf.writeUInt16LE(0, 28);
  name.copy(buf, 30);
  return buf;
}

function dataDescriptor(crc: number, compressed: number, uncompressed: number): Buffer {
  const needsZip64 = compressed > ZIP64_THRESHOLD || uncompressed > ZIP64_THRESHOLD;
  if (needsZip64) {
    const buf = Buffer.alloc(24);
    buf.writeUInt32LE(SIG_DATA_DESCRIPTOR, 0);
    buf.writeUInt32LE(crc >>> 0, 4);
    buf.writeBigUInt64LE(BigInt(compressed), 8);
    buf.writeBigUInt64LE(BigInt(uncompressed), 16);
    return buf;
  }
  const buf = Buffer.alloc(16);
  buf.writeUInt32LE(SIG_DATA_DESCRIPTOR, 0);
  buf.writeUInt32LE(crc >>> 0, 4);
  buf.writeUInt32LE(compressed >>> 0, 8);
  buf.writeUInt32LE(uncompressed >>> 0, 12);
  return buf;
}

function buildZip64Extra(entry: CentralEntry): Buffer {
  const fields: bigint[] = [];
  const needUncompressed = entry.uncompressedSize > ZIP64_THRESHOLD;
  const needCompressed = entry.compressedSize > ZIP64_THRESHOLD;
  const needOffset = entry.offset > ZIP64_THRESHOLD;
  if (needUncompressed) fields.push(BigInt(entry.uncompressedSize));
  if (needCompressed) fields.push(BigInt(entry.compressedSize));
  if (needOffset) fields.push(BigInt(entry.offset));
  const buf = Buffer.alloc(4 + fields.length * 8);
  buf.writeUInt16LE(0x0001, 0);
  buf.writeUInt16LE(fields.length * 8, 2);
  for (let i = 0; i < fields.length; i++) buf.writeBigUInt64LE(fields[i], 4 + i * 8);
  return buf;
}

function centralHeader(entry: CentralEntry): Buffer {
  const needsZip64 =
    entry.compressedSize > ZIP64_THRESHOLD ||
    entry.uncompressedSize > ZIP64_THRESHOLD ||
    entry.offset > ZIP64_THRESHOLD;

  const extra = needsZip64 ? buildZip64Extra(entry) : Buffer.alloc(0);
  const date = new Date(entry.mtime);
  const buf = Buffer.alloc(46 + entry.name.length + extra.length);
  buf.writeUInt32LE(SIG_CENTRAL, 0);
  buf.writeUInt16LE(45, 4);
  buf.writeUInt16LE(45, 6);
  buf.writeUInt16LE(FLAG_USE_DATA_DESCRIPTOR | FLAG_UTF8, 8);
  buf.writeUInt16LE(entry.method, 10);
  buf.writeUInt16LE(dosTime(date), 12);
  buf.writeUInt16LE(dosDate(date), 14);
  buf.writeUInt32LE(entry.crc32 >>> 0, 16);
  buf.writeUInt32LE(Math.min(entry.compressedSize, 0xffffffff) >>> 0, 20);
  buf.writeUInt32LE(Math.min(entry.uncompressedSize, 0xffffffff) >>> 0, 24);
  buf.writeUInt16LE(entry.name.length, 28);
  buf.writeUInt16LE(extra.length, 30);
  buf.writeUInt16LE(0, 32);
  buf.writeUInt16LE(0, 34);
  buf.writeUInt16LE(0, 36);
  buf.writeUInt32LE(0, 38);
  buf.writeUInt32LE(Math.min(entry.offset, 0xffffffff) >>> 0, 42);
  entry.name.copy(buf, 46);
  extra.copy(buf, 46 + entry.name.length);
  return buf;
}

function endOfCentralDir(
  totalEntries: number,
  cdSize: number,
  cdOffset: number,
  needsZip64: boolean,
): Buffer {
  const parts: Buffer[] = [];

  if (needsZip64) {
    const eocd64 = Buffer.alloc(56);
    eocd64.writeUInt32LE(SIG_EOCD64, 0);
    eocd64.writeBigUInt64LE(BigInt(44), 4);
    eocd64.writeUInt16LE(45, 12);
    eocd64.writeUInt16LE(45, 14);
    eocd64.writeUInt32LE(0, 16);
    eocd64.writeUInt32LE(0, 20);
    eocd64.writeBigUInt64LE(BigInt(totalEntries), 24);
    eocd64.writeBigUInt64LE(BigInt(totalEntries), 32);
    eocd64.writeBigUInt64LE(BigInt(cdSize), 40);
    eocd64.writeBigUInt64LE(BigInt(cdOffset), 48);
    parts.push(eocd64);

    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(SIG_EOCD64_LOCATOR, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);
    locator.writeUInt32LE(1, 16);
    parts.push(locator);
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Math.min(totalEntries, 0xffff), 8);
  eocd.writeUInt16LE(Math.min(totalEntries, 0xffff), 10);
  eocd.writeUInt32LE(Math.min(cdSize, 0xffffffff) >>> 0, 12);
  eocd.writeUInt32LE(Math.min(cdOffset, 0xffffffff) >>> 0, 16);
  eocd.writeUInt16LE(0, 20);
  parts.push(eocd);

  return Buffer.concat(parts);
}

export interface ZipPlanFile {
  /** Path within the archive (POSIX, no leading /, may contain subdirs). */
  zipPath: string;
  /** Absolute filesystem path of the source file. */
  absolutePath: string;
  /** Modification time used for the entry header. */
  mtimeMs: number;
  /** File size in bytes. */
  size: number;
}

export interface ZipBuildOptions {
  files: ZipPlanFile[];
  /** Whether to deflate a given entry. Defaults to a sensible heuristic. */
  compress?: (f: ZipPlanFile) => boolean;
}

const NO_COMPRESS_EXT = new Set([
  'zip', 'gz', 'bz2', 'xz', 'rar', '7z',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic',
  'mp3', 'mp4', 'mkv', 'mov', 'webm', 'ogg', 'opus',
  'pdf',
]);

function defaultShouldCompress(f: ZipPlanFile): boolean {
  const ext = f.zipPath.split('.').pop()?.toLowerCase() ?? '';
  if (NO_COMPRESS_EXT.has(ext)) return false;
  if (f.size > 32 * 1024 * 1024) return false;
  return true;
}

/**
 * Build a streaming ZIP archive as a Node Readable. Files that fail to read
 * are skipped and listed in a synthetic `_xopc_errors.txt` trailer entry.
 */
export function createZipStream(opts: ZipBuildOptions): Readable {
  const errors: string[] = [];
  const central: CentralEntry[] = [];
  const compress = opts.compress ?? defaultShouldCompress;
  const stream = new Readable({ read() {} });
  let position = 0;

  function pushBuf(buf: Buffer): void {
    position += buf.length;
    stream.push(buf);
  }

  async function emitEntry(file: ZipPlanFile): Promise<void> {
    const nameBuf = Buffer.from(file.zipPath, 'utf8');
    const method = compress(file) ? METHOD_DEFLATE : METHOD_STORE;
    const offset = position;
    const mtime = file.mtimeMs > 0 ? file.mtimeMs : Date.now();
    pushBuf(localFileHeader(nameBuf, new Date(mtime), method));

    let uncompressed = 0;
    let compressed = 0;
    let crc = 0;

    const source = createReadStream(file.absolutePath);

    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as ArrayBufferLike);
        uncompressed += buf.length;
        crc = crc32(buf, crc);
        cb(null, buf);
      },
    });

    const sink = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as ArrayBufferLike);
        compressed += buf.length;
        pushBuf(buf);
        cb();
      },
    });

    if (method === METHOD_DEFLATE) {
      await pipelineAsync(source, counter, createDeflateRaw({ level: 6 }), sink);
    } else {
      await pipelineAsync(source, counter, sink);
    }

    pushBuf(dataDescriptor(crc, compressed, uncompressed));
    central.push({
      name: nameBuf,
      mtime,
      crc32: crc,
      compressedSize: compressed,
      uncompressedSize: uncompressed,
      offset,
      method,
    });
  }

  async function emitSyntheticTextEntry(zipPath: string, content: string): Promise<void> {
    const nameBuf = Buffer.from(zipPath, 'utf8');
    const offset = position;
    const mtime = Date.now();
    pushBuf(localFileHeader(nameBuf, new Date(mtime), METHOD_STORE));
    const buf = Buffer.from(content, 'utf8');
    const crc = crc32(buf, 0);
    pushBuf(buf);
    pushBuf(dataDescriptor(crc, buf.length, buf.length));
    central.push({
      name: nameBuf,
      mtime,
      crc32: crc,
      compressedSize: buf.length,
      uncompressedSize: buf.length,
      offset,
      method: METHOD_STORE,
    });
  }

  (async () => {
    try {
      for (const file of opts.files) {
        try {
          await emitEntry(file);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${file.zipPath}: ${msg}`);
        }
      }
      if (errors.length > 0) {
        await emitSyntheticTextEntry('_xopc_errors.txt', errors.join('\n'));
      }

      const cdOffset = position;
      let needsZip64 = central.length > COUNT_ZIP64_THRESHOLD;
      for (const entry of central) {
        if (
          entry.compressedSize > ZIP64_THRESHOLD ||
          entry.uncompressedSize > ZIP64_THRESHOLD ||
          entry.offset > ZIP64_THRESHOLD
        ) {
          needsZip64 = true;
        }
        pushBuf(centralHeader(entry));
      }
      const cdSize = position - cdOffset;
      pushBuf(endOfCentralDir(central.length, cdSize, cdOffset, needsZip64));
      stream.push(null);
    } catch (err) {
      stream.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return stream;
}

// ── Planner: walk a directory share into a flat ZipPlanFile list ─────────────

export interface PlanDirectoryOpts {
  /** Sub-path inside the share to start from ('' for whole share). */
  rootRelativePath: string;
  /** Maximum entries returned. */
  maxFileCount: number;
  /** Maximum aggregate file size. */
  maxFolderSize: number;
  /** Whether symlinks are followed (and re-validated against workspace). */
  followSymlinks: boolean;
  /** Walk depth cap. */
  maxDepth: number;
}

export async function planDirectoryFiles(
  record: ShareRecord,
  opts: PlanDirectoryOpts,
): Promise<ZipPlanFile[]> {
  if (record.kind !== 'directory') return [];
  const rootAbs = resolvePath(record.absolutePath, opts.rootRelativePath);
  const files: ZipPlanFile[] = [];
  let totalSize = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > opts.maxDepth) return;
    if (files.length >= opts.maxFileCount) return;
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (files.length >= opts.maxFileCount) return;
      const abs = resolvePath(dir, dirent.name);
      const childLstat = await lstat(abs);
      let stats = childLstat;
      if (childLstat.isSymbolicLink()) {
        if (!opts.followSymlinks) continue;
        const real = await realpath(abs);
        if (!isPathUnderWorkspace(record.workspaceRoot, real)) continue;
        const relToShare = relPathPosix(record.absolutePath, real);
        if (relToShare.startsWith('..')) continue;
        stats = await stat(abs);
      }
      if (stats.isFile()) {
        totalSize += stats.size;
        if (totalSize > opts.maxFolderSize) {
          throw new Error('zip exceeds maxFolderSize');
        }
        const zipRel = relPathPosix(rootAbs, abs).split(/[\\/]/).join('/');
        files.push({
          zipPath: zipRel,
          absolutePath: abs,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
        });
      } else if (stats.isDirectory()) {
        await walk(abs, depth + 1);
      }
    }
  }

  const rootLstat = await lstat(rootAbs);
  if (rootLstat.isDirectory()) {
    await walk(rootAbs, 0);
  } else if (rootLstat.isFile()) {
    const rootStat = await stat(rootAbs);
    files.push({
      zipPath: relPathPosix(record.absolutePath, rootAbs).split(/[\\/]/).join('/'),
      absolutePath: rootAbs,
      mtimeMs: rootStat.mtimeMs,
      size: rootStat.size,
    });
  }
  return files;
}
