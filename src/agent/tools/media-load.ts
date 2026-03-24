import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { checkFileSafety } from '../prompt/safety.js';
import { decodeDataUrl } from './image-tool.helpers.js';

export type LoadedImage = { buffer: Buffer; mimeType: string };

function expandUser(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(homedir(), p.slice(1));
  }
  return p;
}

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

/**
 * Load image bytes from a data URL, http(s) URL, or local path.
 * Local paths must stay under `workspace` or `localRoots` when provided.
 */
export async function loadImageForToolInput(
  rawInput: string,
  opts: {
    maxBytes: number;
    workspace: string;
    localRoots?: string[];
  },
): Promise<LoadedImage> {
  const trimmed = rawInput.trim();
  const input = trimmed.startsWith('@') ? trimmed.slice(1).trim() : trimmed;
  if (!input) {
    throw new Error('empty image reference');
  }

  const looksLikeWindowsDrive = /^[a-zA-Z]:[\\/]/.test(input);
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(input);
  const isFileUrl = /^file:/i.test(input);
  const isHttpUrl = /^https?:\/\//i.test(input);
  const isDataUrl = /^data:/i.test(input);

  if (hasScheme && !looksLikeWindowsDrive && !isFileUrl && !isHttpUrl && !isDataUrl) {
    throw new Error(
      `Unsupported image reference: ${rawInput}. Use a file path, file://, data:, or http(s) URL.`,
    );
  }

  if (isDataUrl) {
    const d = decodeDataUrl(input);
    if (d.buffer.length > opts.maxBytes) {
      throw new Error(`Image too large (${d.buffer.length} bytes, max ${opts.maxBytes})`);
    }
    return { buffer: d.buffer, mimeType: d.mimeType };
  }

  if (isHttpUrl) {
    const res = await fetch(input, { redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`Failed to fetch image: HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > opts.maxBytes) {
      throw new Error(`Image too large (${buf.length} bytes, max ${opts.maxBytes})`);
    }
    const ct = res.headers.get('content-type') || 'image/png';
    return { buffer: buf, mimeType: ct.split(';')[0]?.trim() || 'image/png' };
  }

  let filePath = input;
  if (isFileUrl) {
    filePath = input.slice('file://'.length);
  }
  filePath = expandUser(filePath);
  if (!path.isAbsolute(filePath)) {
    filePath = path.resolve(opts.workspace, filePath);
  } else {
    filePath = path.normalize(filePath);
  }

  const safety = checkFileSafety('read', filePath);
  if (!safety.allowed) {
    throw new Error(safety.message ?? 'File path not allowed');
  }

  const roots = [...(opts.localRoots ?? []), opts.workspace].filter(Boolean);
  const realPath = await fs.realpath(filePath).catch(() => filePath);
  const workspaceReal = await fs.realpath(opts.workspace).catch(() => opts.workspace);
  const resolvedRoots = await Promise.all(roots.map((r) => fs.realpath(r).catch(() => r)));
  if (!isPathUnderRoots(realPath, [workspaceReal, ...resolvedRoots])) {
    throw new Error(`Path not under workspace or allowed roots: ${filePath}`);
  }

  const st = await fs.stat(realPath);
  if (!st.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }
  if (st.size > opts.maxBytes) {
    throw new Error(`Image too large (${st.size} bytes, max ${opts.maxBytes})`);
  }

  const buffer = await fs.readFile(realPath);
  const ext = path.extname(realPath).toLowerCase();
  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.gif'
          ? 'image/gif'
          : ext === '.webp'
            ? 'image/webp'
            : 'image/png';

  return { buffer, mimeType: mime };
}
