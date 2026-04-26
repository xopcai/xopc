import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { getWorkspacePath } from '@xopcai/xopc/config/schema.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import { checkFileSafety } from '@xopcai/xopc/agent/prompt/safety.js';
import { getMimeType } from '@xopcai/xopc/channels/media.js';

export type LoadedMedia = {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  stream: Readable;
};

function isPathUnderRoots(resolved: string, roots: string[]): boolean {
  const norm = path.normalize(resolved);
  for (const root of roots) {
    const r = path.normalize(root);
    if (norm === r || norm.startsWith(r + path.sep)) {
      return true;
    }
  }
  return false;
}

export async function loadMediaForFeishu(
  cfg: Config,
  rawInput: string,
  opts: { maxBytes: number; localRoots?: readonly string[] },
): Promise<LoadedMedia> {
  const input = rawInput.trim().startsWith('@') ? rawInput.trim().slice(1).trim() : rawInput.trim();
  if (!input) throw new Error('empty media reference');

  const isHttpUrl = /^https?:\/\//i.test(input);
  const isFileUrl = /^file:\/\//i.test(input);
  const isDataUrl = /^data:/i.test(input);

  if (isHttpUrl) {
    const res = await fetch(input, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Failed to fetch media: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > opts.maxBytes) throw new Error(`Media too large (${buf.length} bytes, max ${opts.maxBytes})`);
    const ct = res.headers.get('content-type') || 'application/octet-stream';
    const mime = ct.split(';')[0]?.trim() || 'application/octet-stream';
    const nameFromUrl = safeBasename(new URL(input).pathname) || 'media.bin';
    return { buffer: buf, mimeType: mime, filename: nameFromUrl, stream: Readable.from(buf) };
  }

  if (isDataUrl) {
    // data:[<mime>][;base64],<data>
    const m = /^data:([^;,]+)?(;base64)?,/i.exec(input);
    if (!m) throw new Error('Invalid data URL');
    const mime = (m[1] || 'application/octet-stream').trim();
    const isB64 = Boolean(m[2]);
    const dataPart = input.slice(m[0].length);
    const buf = isB64 ? Buffer.from(dataPart, 'base64') : Buffer.from(decodeURIComponent(dataPart), 'utf8');
    if (buf.length > opts.maxBytes) throw new Error(`Media too large (${buf.length} bytes, max ${opts.maxBytes})`);
    const filename = mime.startsWith('image/') ? `image.${mime.split('/')[1] || 'bin'}` : 'media.bin';
    return { buffer: buf, mimeType: mime, filename, stream: Readable.from(buf) };
  }

  // Heuristic: some callers persist raw base64 (no data: prefix). If it looks like base64, treat it as such.
  // This avoids mis-classifying huge base64 blobs as file paths during outbound replay.
  const b64Candidate = input.replace(/^['"]|['"]$/g, '');
  const looksBase64 =
    b64Candidate.length >= 256 &&
    b64Candidate.length % 4 === 0 &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(b64Candidate) &&
    !b64Candidate.includes(path.sep);
  if (looksBase64) {
    const buf = Buffer.from(b64Candidate, 'base64');
    if (buf.length > 0) {
      if (buf.length > opts.maxBytes) throw new Error(`Media too large (${buf.length} bytes, max ${opts.maxBytes})`);
      const { mimeType, filename } = sniffBufferType(buf);
      return { buffer: buf, mimeType, filename, stream: Readable.from(buf) };
    }
  }

  let filePath = input;
  if (isFileUrl) filePath = input.slice('file://'.length);
  if (!path.isAbsolute(filePath)) {
    filePath = path.resolve(getWorkspacePath(cfg), filePath);
  }
  filePath = path.normalize(filePath);

  const safety = checkFileSafety('read', filePath);
  if (!safety.allowed) throw new Error(safety.message ?? 'File path not allowed');

  const workspace = getWorkspacePath(cfg);
  const roots = [workspace, ...(opts.localRoots ?? [])].filter(Boolean) as string[];
  const realPath = await fs.realpath(filePath).catch(() => filePath);
  const workspaceReal = await fs.realpath(workspace).catch(() => workspace);
  const resolvedRoots = await Promise.all(roots.map((r) => fs.realpath(r).catch(() => r)));
  if (!isPathUnderRoots(realPath, [workspaceReal, ...resolvedRoots])) {
    throw new Error(`Path not under workspace or allowed roots: ${filePath}`);
  }

  const st = await fs.stat(realPath).catch((err) => {
    const em = err instanceof Error ? err.message : String(err);
    throw new Error(`Media file not found or unreadable: ${filePath} (resolved: ${realPath}). ${em}`);
  });
  if (!st.isFile()) throw new Error(`Not a file: ${filePath}`);
  if (st.size > opts.maxBytes) throw new Error(`Media too large (${st.size} bytes, max ${opts.maxBytes})`);

  const buffer = await fs.readFile(realPath);
  const filename = path.basename(realPath) || 'media.bin';
  const mimeType = getMimeType('document', realPath);
  return { buffer, mimeType, filename, stream: Readable.from(buffer) };
}

function sniffBufferType(buf: Buffer): { mimeType: string; filename: string } {
  // PNG
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { mimeType: 'image/png', filename: 'image.png' };
  }
  // JPEG
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mimeType: 'image/jpeg', filename: 'image.jpg' };
  }
  // GIF
  if (buf.length >= 6 && buf.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return { mimeType: 'image/gif', filename: 'image.gif' };
  }
  // WEBP (RIFF....WEBP)
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', filename: 'image.webp' };
  }
  // PDF
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === '%PDF') {
    return { mimeType: 'application/pdf', filename: 'file.pdf' };
  }
  return { mimeType: 'application/octet-stream', filename: 'media.bin' };
}

function safeBasename(p: string): string {
  try {
    const b = path.basename(p);
    return b.replace(/[\\/:*?"<>|]/g, '_');
  } catch {
    return '';
  }
}

