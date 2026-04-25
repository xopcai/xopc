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

function safeBasename(p: string): string {
  try {
    const b = path.basename(p);
    return b.replace(/[\\/:*?"<>|]/g, '_');
  } catch {
    return '';
  }
}

