import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, parse as parsePath } from 'node:path';
import { randomUUID } from 'node:crypto';

import { getMediaBucketDir, getMediaDir, isPathInside } from './paths.js';
import { buildMediaUri } from './uri.js';
import type { MediaBucket, SavedMedia } from './types.js';

/** Default per-file cap for inbound staging (5 MiB). */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;

const MEDIA_DIR_MODE = 0o700;
const MEDIA_FILE_MODE = 0o644;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.svgz': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

function sanitizeFilename(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'file';
  return base.slice(0, 60);
}

function extFromMime(mimeType: string | undefined, fallbackName?: string): string {
  if (mimeType) {
    const m = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (m === 'image/jpeg') return '.jpg';
    if (m === 'image/png') return '.png';
    if (m === 'image/webp') return '.webp';
    if (m === 'image/gif') return '.gif';
    if (m === 'image/svg+xml') return '.svg';
    if (m === 'application/pdf') return '.pdf';
    if (m === 'audio/ogg') return '.ogg';
    if (m === 'audio/mpeg') return '.mp3';
    if (m === 'audio/wav') return '.wav';
    if (m === 'audio/webm') return '.webm';
    if (m === 'audio/mp4') return '.m4a';
    if (m === 'text/plain') return '.txt';
  }
  const fromName = fallbackName ? extname(fallbackName).toLowerCase() : '';
  if (fromName && fromName.length <= 10) return fromName;
  return '.bin';
}

function buildSavedMediaId(opts: {
  baseId: string;
  ext: string;
  originalFilename?: string;
}): string {
  const ext = opts.ext.startsWith('.') ? opts.ext : `.${opts.ext}`;
  if (opts.originalFilename) {
    const stem = sanitizeFilename(parsePath(opts.originalFilename).name);
    if (stem) {
      return `${stem}---${opts.baseId}${ext}`;
    }
  }
  return `${opts.baseId}${ext}`;
}

function assertSafeMediaId(id: string, caller: string): void {
  if (!id || id.includes('/') || id.includes('\\') || id.includes('\0') || id === '..') {
    throw new Error(`${caller}: unsafe media id: ${JSON.stringify(id)}`);
  }
}

function assertSafeBucket(bucket: string): asserts bucket is MediaBucket {
  if (bucket !== 'inbound' && bucket !== 'tts' && bucket !== 'outbound' && bucket !== 'work-item') {
    throw new Error(`Unsupported media bucket: ${JSON.stringify(bucket)}`);
  }
}

export async function ensureMediaDir(): Promise<string> {
  const root = getMediaDir();
  await mkdir(root, { recursive: true, mode: MEDIA_DIR_MODE });
  return root;
}

export async function saveMediaBuffer(
  buffer: Buffer,
  opts?: {
    contentType?: string;
    bucket?: MediaBucket;
    maxBytes?: number;
    originalFilename?: string;
  },
): Promise<SavedMedia> {
  const bucket = opts?.bucket ?? 'inbound';
  const maxBytes = opts?.maxBytes ?? MEDIA_MAX_BYTES;
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Media exceeds ${Math.floor(maxBytes / (1024 * 1024))}MB limit`);
  }

  await ensureMediaDir();
  const dir = getMediaBucketDir(bucket);
  await mkdir(dir, { recursive: true, mode: MEDIA_DIR_MODE });

  const baseId = randomUUID();
  const ext = extFromMime(opts?.contentType, opts?.originalFilename);
  const id = buildSavedMediaId({ baseId, ext, originalFilename: opts?.originalFilename });
  assertSafeMediaId(id, 'saveMediaBuffer');

  const absPath = join(dir, id);
  if (!isPathInside(dir, absPath)) {
    throw new Error('Media path escapes bucket directory');
  }

  await writeFile(absPath, buffer, { mode: MEDIA_FILE_MODE });
  const uri = buildMediaUri(bucket, id);

  return {
    id,
    path: absPath,
    size: buffer.byteLength,
    contentType: opts?.contentType?.split(';')[0]?.trim() || MIME_BY_EXT[ext] || 'application/octet-stream',
    bucket,
    uri,
  };
}

export function resolveMediaBufferPath(id: string, bucket: MediaBucket = 'inbound'): string {
  assertSafeBucket(bucket);
  assertSafeMediaId(id, 'resolveMediaBufferPath');
  const dir = getMediaBucketDir(bucket);
  const abs = join(dir, id);
  if (!isPathInside(dir, abs)) {
    throw new Error('Media path escapes bucket directory');
  }
  return abs;
}

export async function readMediaBuffer(
  id: string,
  bucket: MediaBucket = 'inbound',
  maxBytes = MEDIA_MAX_BYTES,
): Promise<{ id: string; path: string; buffer: Buffer; size: number }> {
  const path = resolveMediaBufferPath(id, bucket);
  const buffer = await readFile(path);
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Media ${JSON.stringify(id)} exceeds read limit`);
  }
  return { id, path, buffer, size: buffer.byteLength };
}

export async function deleteMediaBuffer(id: string, bucket: MediaBucket = 'inbound'): Promise<void> {
  const path = resolveMediaBufferPath(id, bucket);
  await rm(path, { force: true });
}

export function mimeTypeFromMediaPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}
