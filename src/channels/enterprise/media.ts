import { promises as fs } from 'node:fs';
import path from 'node:path';

import { checkFileSafety } from '../../agent/prompt/safety.js';
import { evaluateFilePolicy } from '../../agent/sandbox/exec-policy.js';
import { assertUrlSafe } from '../../agent/tools/url-safety.js';
import type { Config } from '../../config/schema.js';
import { getWorkspacePath } from '../../config/workspace-path-helpers.js';
import { isXopcDatabaseOpen } from '../../storage/sqlite/index.js';
import { getMimeType } from '../media.js';

export type EnterpriseMediaKind = 'image' | 'video' | 'audio' | 'file';

export interface EnterpriseMedia {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  kind: EnterpriseMediaKind;
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/amr': 'amr',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/json': 'json',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'text/html': 'html',
};

function isPathUnderRoots(resolved: string, roots: string[]): boolean {
  const norm = path.normalize(resolved);
  for (const root of roots) {
    const r = path.normalize(root);
    if (norm === r || norm.startsWith(r + path.sep)) return true;
  }
  return false;
}

function sniffBufferMime(buf: Buffer): string | undefined {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'GIF8') {
    return 'image/gif';
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF'
      && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'OggS') {
    return 'audio/ogg';
  }
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    return 'video/mp4';
  }
  if (buf.length >= 6 && buf.subarray(0, 6).toString('ascii') === '#!AMR\n') {
    return 'audio/amr';
  }
  return undefined;
}

function sanitizeFilename(raw: string | undefined): string {
  if (!raw?.trim()) return '';
  const base = path.basename(raw.trim()).replace(/[\\/:*?"<>|\r\n\0]/g, '_').trim();
  if (!base || base === '.' || base === '..') return '';
  return base;
}

function extensionForMime(mimeType: string): string {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() || '';
  if (MIME_TO_EXT[normalized]) return MIME_TO_EXT[normalized];
  const sub = normalized.split('/')[1]?.replace(/[^a-z0-9]/g, '');
  return sub && sub !== 'octetstream' ? sub : 'bin';
}

function resolveKind(mimeType: string, mediaType?: string): EnterpriseMediaKind {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() || '';
  if (normalized === 'image/svg+xml') return 'file';
  if (mediaType === 'photo') return normalized.startsWith('image/') || !normalized ? 'image' : 'file';
  if (mediaType === 'video') return 'video';
  if (mediaType === 'audio') return 'audio';
  if (mediaType === 'document') return 'file';
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  return 'file';
}

function buildFilename(hint: string | undefined, fallback: string | undefined, kind: EnterpriseMediaKind, mimeType: string): string {
  const clean = sanitizeFilename(hint) || sanitizeFilename(fallback);
  if (clean) return clean;
  const ext = extensionForMime(mimeType);
  const prefix = kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'file';
  return `${prefix}.${ext}`;
}

const MAX_REMOTE_REDIRECTS = 5;

async function fetchSafeRemoteMedia(
  initialUrl: string,
  maxBytes: number,
): Promise<{ buffer: Buffer; headerMime: string; finalUrl: string }> {
  let currentUrl = initialUrl;
  let response: Response | undefined;
  for (let hop = 0; hop <= MAX_REMOTE_REDIRECTS; hop += 1) {
    assertUrlSafe(currentUrl);
    response = await fetch(currentUrl, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error(`Media redirect missing Location header (HTTP ${response.status})`);
      if (hop === MAX_REMOTE_REDIRECTS) throw new Error('Too many redirects while fetching media');
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    break;
  }
  if (!response || !response.ok) {
    await response?.body?.cancel();
    throw new Error(`Failed to fetch media (HTTP ${response?.status ?? 'unknown'})`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Media too large (${contentLength} bytes, max ${maxBytes})`);
  }

  let buffer: Buffer;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error(`Media too large (${total} bytes, max ${maxBytes})`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    buffer = Buffer.concat(chunks, total);
  } else {
    buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`Media too large (${buffer.length} bytes, max ${maxBytes})`);
    }
  }

  if (buffer.length === 0) throw new Error('Media payload is empty');
  const headerMime = (response.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase() || '';
  return { buffer, headerMime, finalUrl: currentUrl };
}

export async function loadEnterpriseMedia(
  cfg: Config,
  rawInput: string,
  options?: {
    mediaType?: string;
    filenameHint?: string;
    maxBytes?: number;
    localRoots?: readonly string[];
  },
): Promise<EnterpriseMedia> {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const trimmed = rawInput.trim();
  const input = trimmed.startsWith('@') ? trimmed.slice(1).trim() : trimmed;
  if (!input) throw new Error('Media URL is required');

  let buffer: Buffer;
  let mimeType: string;
  let fallbackName: string | undefined;

  if (/^data:/i.test(input)) {
    const match = /^data:([^;,]+)?(;base64)?,/i.exec(input);
    if (!match) throw new Error('Invalid media data URL');
    const declaredMime = (match[1] || 'application/octet-stream').trim().toLowerCase();
    const dataPart = input.slice(match[0].length);
    buffer = match[2]
      ? Buffer.from(dataPart.replace(/\s/g, ''), 'base64')
      : Buffer.from(decodeURIComponent(dataPart), 'utf8');
    if (buffer.length === 0) throw new Error('Media payload is empty');
    if (buffer.length > maxBytes) throw new Error(`Media too large (${buffer.length} bytes, max ${maxBytes})`);
    mimeType = declaredMime === 'application/octet-stream'
      ? (sniffBufferMime(buffer) ?? declaredMime)
      : declaredMime;
  } else if (/^https?:\/\//i.test(input)) {
    const fetched = await fetchSafeRemoteMedia(input, maxBytes);
    buffer = fetched.buffer;
    fallbackName = sanitizeFilename(new URL(fetched.finalUrl).pathname);
    mimeType = fetched.headerMime && fetched.headerMime !== 'application/octet-stream'
      ? fetched.headerMime
      : (sniffBufferMime(buffer) ?? (fallbackName ? getMimeType('document', fallbackName) : 'application/octet-stream'));
  } else {
    let filePath = input.startsWith('file://') ? input.slice('file://'.length) : input;
    const workspace = isXopcDatabaseOpen()
      ? getWorkspacePath(cfg)
      : (options?.localRoots?.[0] || process.env.XOPC_WORKSPACE?.trim() || '');
    if (!workspace) throw new Error('Workspace root is unavailable for local media');
    if (!path.isAbsolute(filePath)) filePath = path.resolve(workspace, filePath);
    filePath = path.normalize(filePath);

    const preSafety = checkFileSafety('read', filePath);
    if (!preSafety.allowed) throw new Error(preSafety.message ?? 'File path not allowed');

    const roots = [workspace, ...(options?.localRoots ?? [])].filter(Boolean) as string[];
    const [realPath, ...resolvedRoots] = await Promise.all([
      fs.realpath(filePath),
      ...roots.map((r) => fs.realpath(r).catch(() => r)),
    ]);
    if (!isPathUnderRoots(realPath, resolvedRoots)) {
      throw new Error(`Media path escapes allowed workspace roots: ${filePath}`);
    }
    const policy = evaluateFilePolicy({
      operation: 'read',
      path: realPath,
      workspaceRoot: resolvedRoots[0] ?? workspace,
      config: { allowedRoots: resolvedRoots },
    });
    if (!policy.allowed) throw new Error(policy.reason ?? 'File path not allowed');
    const canonicalSafety = checkFileSafety('read', realPath);
    if (!canonicalSafety.allowed) throw new Error(canonicalSafety.message ?? 'File path not allowed');

    const st = await fs.stat(realPath);
    if (!st.isFile()) throw new Error(`Media path is not a file: ${filePath}`);
    if (st.size === 0) throw new Error('Media file is empty');
    if (st.size > maxBytes) throw new Error(`Media too large (${st.size} bytes, max ${maxBytes})`);

    buffer = await fs.readFile(realPath);
    fallbackName = path.basename(realPath);
    const extMime = getMimeType('document', realPath);
    mimeType = extMime !== 'application/octet-stream' ? extMime : (sniffBufferMime(buffer) ?? extMime);
  }

  const kind = resolveKind(mimeType, options?.mediaType);
  const filename = buildFilename(options?.filenameHint, fallbackName, kind, mimeType);
  return { buffer, mimeType, filename, kind };
}
