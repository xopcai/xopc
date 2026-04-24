import type { Hono } from 'hono';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { extractProfileAgentId } from '../../../config/agent-profile.js';
import { type Config, getWorkspacePath } from '../../../config/schema.js';
import { resolveSafeInboundFilePath } from '../../../channels/attachments/inbound-persist.js';
import { resolveSafeTtsFilePath } from '../../../channels/attachments/outbound-tts-persist.js';
import {
  listAgentEntries,
  normalizeAgentId,
  resolveAgentHomeDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from '../../../agent/agent-scope.js';
import { createLogger } from '../../../utils/logger.js';
import { resolveHeartbeatMdPath } from '../../workspace-heartbeat-path.js';
import {
  isPathUnderWorkspace,
  resolveWorkspaceSafePath,
  toWorkspaceRelativePosix,
} from '../../workspace-editor-path.js';
import { listWorkspaceRelativeFilesFsFallback } from '../../workspace-fs-file-list.js';
import { runRipgrepInDirectory, runRipgrepListFiles } from '../../workspace-ripgrep.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import type { GatewayService } from '../../service.js';

const log = createLogger('HonoApp');

/** Agent home for persisted `inbound/` and `tts/` attachments (matches `persistOutboundTtsAudio` / `prepareInboundAttachments`). */
function resolvePersistedAttachmentAgentHome(cfg: Config, sessionKeyRaw: string | undefined): string {
  const sk = typeof sessionKeyRaw === 'string' ? sessionKeyRaw.trim() : '';
  const agentId = sk ? extractProfileAgentId(sk, cfg) : resolveDefaultAgentId(cfg);
  return resolveAgentHomeDir(cfg, agentId);
}

const FILE_SEARCH_MAX_LIMIT = 50;

/** Subsequence fuzzy match: all query chars appear in order in `candidate` (case-insensitive). */
function fuzzySubsequenceScore(query: string, candidate: string): number | null {
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  if (q.length === 0) return 0;
  let qi = 0;
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] === q[qi]) qi++;
  }
  if (qi < q.length) return null;
  const base = c.split('/').pop() ?? c;
  let score = 10;
  if (c.startsWith(q)) score += 40;
  if (base.startsWith(q)) score += 35;
  else if (base.includes(q)) score += 20;
  else if (c.includes(q)) score += 10;
  score -= c.length * 0.0001;
  return score;
}

async function fuzzySearchWorkspaceFiles(
  workspaceRoot: string,
  query: string,
  limit: number,
): Promise<Array<{ name: string; path: string; isDirectory: boolean }>> {
  let files = await runRipgrepListFiles(workspaceRoot);
  if (files.length === 0) {
    files = await listWorkspaceRelativeFilesFsFallback(workspaceRoot, 120_000);
    if (files.length > 0) {
      log.debug(
        { workspaceRoot, fileCount: files.length },
        'workspace files/search: file list from fs walk (ripgrep unavailable or returned empty)',
      );
    }
  }
  const q = query.trim();
  const capped = Math.min(Math.max(limit, 1), FILE_SEARCH_MAX_LIMIT);

  type Row = { name: string; path: string; isDirectory: boolean; score: number };
  const rows: Row[] = [];

  if (!q) {
    const sorted = [...files].sort((a, b) => a.localeCompare(b));
    for (const rel of sorted.slice(0, capped)) {
      const name = rel.split('/').pop() ?? rel;
      rows.push({ name, path: rel, isDirectory: false, score: 0 });
    }
    return rows;
  }

  for (const rel of files) {
    const name = rel.split('/').pop() ?? rel;
    const scorePath = fuzzySubsequenceScore(q, rel);
    const scoreName = fuzzySubsequenceScore(q, name);
    const score = Math.max(scorePath ?? -Infinity, scoreName ?? -Infinity);
    if (score === -Infinity) continue;
    rows.push({ name, path: rel, isDirectory: false, score });
  }

  rows.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return rows.slice(0, capped).map(({ name, path, isDirectory }) => ({ name, path, isDirectory }));
}

function isKnownEditorAgentId(cfg: Config, id: string): boolean {
  const n = normalizeAgentId(id);
  if (n === resolveDefaultAgentId(cfg)) return true;
  return listAgentEntries(cfg).some((e) => normalizeAgentId(e.id) === n);
}

function resolveEditorWorkspaceRoot(
  cfg: Config,
  agentIdRaw: string | undefined,
): { ok: true; root: string } | { ok: false; message: string } {
  const trimmed = typeof agentIdRaw === 'string' ? agentIdRaw.trim() : '';
  if (!trimmed) {
    const root = getWorkspacePath(cfg);
    if (!root) return { ok: false, message: 'Workspace not configured' };
    return { ok: true, root };
  }
  const id = normalizeAgentId(trimmed);
  if (!isKnownEditorAgentId(cfg, id)) {
    return { ok: false, message: 'Unknown agent' };
  }
  return { ok: true, root: resolveAgentWorkspaceDir(cfg, id) };
}

/** Prefer `sessionKey` (per-session workspace override) over `agentId`. */
async function resolveEditorWorkspaceRootAsync(
  service: GatewayService,
  cfg: Config,
  sessionKeyRaw: string | undefined,
  agentIdRaw: string | undefined,
): Promise<{ ok: true; root: string } | { ok: false; message: string }> {
  const sk = typeof sessionKeyRaw === 'string' ? sessionKeyRaw.trim() : '';
  if (sk) {
    try {
      const root = await service.getEffectiveWorkspacePathForSession(sk);
      return { ok: true, root };
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, sessionKey: sk }, 'Session workspace root resolution failed');
      return { ok: false, message: em || 'Session workspace resolution failed' };
    }
  }
  return resolveEditorWorkspaceRoot(cfg, agentIdRaw);
}

export function registerWorkspaceRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  authenticated.get('/api/workspace/inbound-file', async (c) => {
    const rel = c.req.query('rel');
    if (!rel || typeof rel !== 'string') {
      return c.json({ ok: false, error: { message: 'Missing rel' } }, 400);
    }
    const cfg = service.currentConfig;
    const agentHome = resolvePersistedAttachmentAgentHome(cfg, c.req.query('sessionKey'));
    const abs = resolveSafeInboundFilePath({ agentHome }, rel);
    if (!abs) {
      return c.json({ ok: false, error: { message: 'Forbidden' } }, 403);
    }
    try {
      const buf = await readFile(abs);
      const ext = rel.split('.').pop()?.toLowerCase() ?? '';
      const mimeByExt: Record<string, string> = {
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
        md: 'text/markdown',
        txt: 'text/plain',
        json: 'application/json',
        html: 'text/html',
        css: 'text/css',
        js: 'text/javascript',
        ts: 'text/typescript',
        webm: 'audio/webm',
        ogg: 'audio/ogg',
        opus: 'audio/ogg',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
      };
      const contentType = mimeByExt[ext] || 'application/octet-stream';
      return new Response(buf, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch {
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
  });

  authenticated.get('/api/workspace/tts-file', async (c) => {
    const rel = c.req.query('rel');
    if (!rel || typeof rel !== 'string') {
      return c.json({ ok: false, error: { message: 'Missing rel' } }, 400);
    }
    const cfg = service.currentConfig;
    const agentHome = resolvePersistedAttachmentAgentHome(cfg, c.req.query('sessionKey'));
    const abs = resolveSafeTtsFilePath({ agentHome }, rel);
    if (!abs) {
      return c.json({ ok: false, error: { message: 'Forbidden' } }, 403);
    }
    try {
      const buf = await readFile(abs);
      const ext = rel.split('.').pop()?.toLowerCase() ?? '';
      const mimeByExt: Record<string, string> = {
        ogg: 'audio/ogg',
        opus: 'audio/ogg',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
      };
      const contentType = mimeByExt[ext] || 'application/octet-stream';
      return new Response(buf, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch {
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
  });

  authenticated.get('/api/workspace/heartbeat-md', async (c) => {
    const abs = resolveHeartbeatMdPath(service.currentConfig);
    if (!abs) {
      return c.json({ ok: false, error: { message: 'Workspace not configured' } }, 400);
    }
    try {
      const content = await readFile(abs, 'utf-8');
      return c.json({ ok: true, payload: { content: content, file: 'HEARTBEAT.md' } });
    } catch {
      return c.json({ ok: true, payload: { content: '', file: 'HEARTBEAT.md' } });
    }
  });

  authenticated.put('/api/workspace/heartbeat-md', async (c) => {
    const abs = resolveHeartbeatMdPath(service.currentConfig);
    if (!abs) {
      return c.json({ ok: false, error: { message: 'Workspace not configured' } }, 400);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const content =
      typeof body === 'object' &&
      body !== null &&
      'content' in body &&
      typeof (body as { content: unknown }).content === 'string'
        ? (body as { content: string }).content
        : '';
    try {
      await writeFile(abs, content, 'utf-8');
      return c.json({ ok: true, payload: { file: 'HEARTBEAT.md' } });
    } catch (err) {
      log.error({ err, path: abs }, 'Failed to write HEARTBEAT.md');
      return c.json({ ok: false, error: { message: 'Write failed' } }, 500);
    }
  });

  authenticated.get('/api/workspace/editor/list', async (c) => {
    const ws = await resolveEditorWorkspaceRootAsync(
      service,
      service.currentConfig,
      c.req.query('sessionKey'),
      c.req.query('agentId'),
    );
    if (ws.ok === false) {
      return c.json({ ok: false, error: { message: ws.message } }, 400);
    }
    const workspaceRoot = ws.root;
    const dirRel = typeof c.req.query('dir') === 'string' ? c.req.query('dir')! : '';
    const absDir = resolveWorkspaceSafePath(workspaceRoot, dirRel);
    if (!absDir) {
      return c.json({ ok: false, error: { message: 'Invalid path' } }, 400);
    }
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(absDir);
    } catch {
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
    if (!st.isDirectory()) {
      return c.json({ ok: false, error: { message: 'Not a directory' } }, 400);
    }
    const dirents = await readdir(absDir, { withFileTypes: true });
    const entries: { name: string; path: string; absolutePath: string; isDirectory: boolean }[] = [];
    for (const entry of dirents) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = join(absDir, entry.name);
      if (entry.isDirectory()) {
        entries.push({
          name: entry.name,
          path: toWorkspaceRelativePosix(workspaceRoot, fullPath),
          absolutePath: fullPath,
          isDirectory: true,
        });
      } else {
        entries.push({
          name: entry.name,
          path: toWorkspaceRelativePosix(workspaceRoot, fullPath),
          absolutePath: fullPath,
          isDirectory: false,
        });
      }
    }
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return c.json({ ok: true, payload: { entries } });
  });

  authenticated.get('/api/workspace/editor/read', async (c) => {
    const pathRel = typeof c.req.query('path') === 'string' ? c.req.query('path')! : '';
    if (!pathRel.trim()) {
      return c.json({ ok: false, error: { message: 'Missing path' } }, 400);
    }
    const ws = await resolveEditorWorkspaceRootAsync(
      service,
      service.currentConfig,
      c.req.query('sessionKey'),
      c.req.query('agentId'),
    );
    if (ws.ok === false) {
      return c.json({ ok: false, error: { message: ws.message } }, 400);
    }
    const workspaceRoot = ws.root;
    const abs = resolveWorkspaceSafePath(workspaceRoot, pathRel);
    if (!abs) {
      return c.json({ ok: false, error: { message: 'Invalid path' } }, 400);
    }
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(abs);
    } catch {
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
    if (!st.isFile()) {
      return c.json({ ok: false, error: { message: 'Not a file' } }, 400);
    }
    try {
      const content = await readFile(abs, 'utf-8');
      return c.json({
        ok: true,
        payload: {
          content,
          path: toWorkspaceRelativePosix(workspaceRoot, abs),
          mtimeMs: st.mtimeMs,
        },
      });
    } catch {
      return c.json({ ok: false, error: { message: 'Read failed' } }, 500);
    }
  });

  /** Read file as raw bytes and return base64 (for PDF/images in workspace preview — avoids UTF-8 corruption). */
  authenticated.get('/api/workspace/editor/read-base64', async (c) => {
    const pathRel = typeof c.req.query('path') === 'string' ? c.req.query('path')! : '';
    if (!pathRel.trim()) {
      return c.json({ ok: false, error: { message: 'Missing path' } }, 400);
    }
    const ws = await resolveEditorWorkspaceRootAsync(
      service,
      service.currentConfig,
      c.req.query('sessionKey'),
      c.req.query('agentId'),
    );
    if (ws.ok === false) {
      return c.json({ ok: false, error: { message: ws.message } }, 400);
    }
    const workspaceRoot = ws.root;
    const abs = resolveWorkspaceSafePath(workspaceRoot, pathRel);
    if (!abs) {
      return c.json({ ok: false, error: { message: 'Invalid path' } }, 400);
    }
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(abs);
    } catch {
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
    if (!st.isFile()) {
      return c.json({ ok: false, error: { message: 'Not a file' } }, 400);
    }
    try {
      const buf = await readFile(abs);
      return c.json({
        ok: true,
        payload: {
          contentBase64: buf.toString('base64'),
          path: toWorkspaceRelativePosix(workspaceRoot, abs),
          /** Host absolute path — Electron can open with the default app (shell.openPath). */
          absolutePath: abs,
          mtimeMs: st.mtimeMs,
        },
      });
    } catch {
      return c.json({ ok: false, error: { message: 'Read failed' } }, 500);
    }
  });

  /** Map an absolute host path to a workspace-relative path (if under this session’s workspace). */
  authenticated.get('/api/workspace/editor/resolve-path', async (c) => {
    const raw = c.req.query('absolutePath');
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      return c.json({ ok: false, error: { message: 'Missing absolutePath' } }, 400);
    }
    const absolutePath = raw.trim();
    const ws = await resolveEditorWorkspaceRootAsync(
      service,
      service.currentConfig,
      c.req.query('sessionKey'),
      c.req.query('agentId'),
    );
    if (ws.ok === false) {
      return c.json({ ok: false, error: { message: ws.message } }, 400);
    }
    const workspaceRoot = ws.root;
    const normalized = resolve(absolutePath);
    if (!isPathUnderWorkspace(workspaceRoot, normalized)) {
      return c.json({ ok: false, error: { message: 'Path not under workspace' } }, 403);
    }
    const rel = toWorkspaceRelativePosix(workspaceRoot, normalized);
    return c.json({ ok: true, payload: { workspaceRelativePath: rel } });
  });

  /**
   * Serve a workspace file as raw bytes (e.g. <img> after auth fetch + blob URL).
   * Path is workspace-relative; scope via sessionKey / agentId like other editor routes.
   */
  authenticated.get('/api/workspace/editor/raw', async (c) => {
    const pathRel = typeof c.req.query('path') === 'string' ? c.req.query('path')! : '';
    if (!pathRel.trim()) {
      return c.json({ ok: false, error: { message: 'Missing path' } }, 400);
    }
    const ws = await resolveEditorWorkspaceRootAsync(
      service,
      service.currentConfig,
      c.req.query('sessionKey'),
      c.req.query('agentId'),
    );
    if (ws.ok === false) {
      return c.json({ ok: false, error: { message: ws.message } }, 400);
    }
    const workspaceRoot = ws.root;
    const abs = resolveWorkspaceSafePath(workspaceRoot, pathRel);
    if (!abs) {
      return c.json({ ok: false, error: { message: 'Invalid path' } }, 400);
    }
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(abs);
    } catch {
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
    if (!st.isFile()) {
      return c.json({ ok: false, error: { message: 'Not a file' } }, 400);
    }
    const ext = pathRel.split('.').pop()?.toLowerCase() ?? '';
    const mimeByExt: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      md: 'text/markdown',
      json: 'application/json',
      html: 'text/html',
      css: 'text/css',
      js: 'text/javascript',
      ts: 'text/typescript',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      webm: 'video/webm',
      mp4: 'video/mp4',
      mov: 'video/quicktime',
    };
    const contentType = mimeByExt[ext] || 'application/octet-stream';
    try {
      const buf = await readFile(abs);
      return new Response(buf, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch {
      return c.json({ ok: false, error: { message: 'Read failed' } }, 500);
    }
  });

  authenticated.put('/api/workspace/editor/write', async (c) => {
    const ws = await resolveEditorWorkspaceRootAsync(
      service,
      service.currentConfig,
      c.req.query('sessionKey'),
      c.req.query('agentId'),
    );
    if (ws.ok === false) {
      return c.json({ ok: false, error: { message: ws.message } }, 400);
    }
    const workspaceRoot = ws.root;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const pathRel =
      typeof body === 'object' &&
      body !== null &&
      'path' in body &&
      typeof (body as { path: unknown }).path === 'string'
        ? (body as { path: string }).path
        : '';
    const content =
      typeof body === 'object' &&
      body !== null &&
      'content' in body &&
      typeof (body as { content: unknown }).content === 'string'
        ? (body as { content: string }).content
        : '';
    if (!pathRel.trim()) {
      return c.json({ ok: false, error: { message: 'Missing path' } }, 400);
    }
    const abs = resolveWorkspaceSafePath(workspaceRoot, pathRel);
    if (!abs) {
      return c.json({ ok: false, error: { message: 'Invalid path' } }, 400);
    }
    let st: Awaited<ReturnType<typeof stat>> | undefined;
    try {
      st = await stat(abs);
    } catch {
      st = undefined;
    }
    if (st && !st.isFile()) {
      return c.json({ ok: false, error: { message: 'Not a file' } }, 400);
    }
    try {
      await writeFile(abs, content, 'utf-8');
      let mtimeMs: number;
      try {
        mtimeMs = (await stat(abs)).mtimeMs;
      } catch {
        mtimeMs = Date.now();
      }
      return c.json({
        ok: true,
        payload: { path: toWorkspaceRelativePosix(workspaceRoot, abs), mtimeMs },
      });
    } catch (err) {
      log.error({ err, path: abs }, 'workspace editor write failed');
      return c.json({ ok: false, error: { message: 'Write failed' } }, 500);
    }
  });

  authenticated.get('/api/workspace/editor/search', async (c) => {
    const q = typeof c.req.query('q') === 'string' ? c.req.query('q')!.trim() : '';
    const dirRel = typeof c.req.query('dir') === 'string' ? c.req.query('dir')! : '';
    if (!q) {
      return c.json({
        ok: true,
        payload: { results: [] as { filePath: string; lineNumber: number; lineContent: string; matchStart: number; matchEnd: number }[] },
      });
    }
    const ws = await resolveEditorWorkspaceRootAsync(
      service,
      service.currentConfig,
      c.req.query('sessionKey'),
      c.req.query('agentId'),
    );
    if (ws.ok === false) {
      return c.json({ ok: false, error: { message: ws.message } }, 400);
    }
    const workspaceRoot = ws.root;
    const absDir = resolveWorkspaceSafePath(workspaceRoot, dirRel);
    if (!absDir) {
      return c.json({ ok: false, error: { message: 'Invalid path' } }, 400);
    }
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(absDir);
    } catch {
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
    if (!st.isDirectory()) {
      return c.json({ ok: false, error: { message: 'Not a directory' } }, 400);
    }
    const raw = await runRipgrepInDirectory(q, absDir);
    const results = raw
      .filter((r) => isPathUnderWorkspace(workspaceRoot, r.filePath))
      .map((r) => ({
        ...r,
        filePath: toWorkspaceRelativePosix(workspaceRoot, resolve(r.filePath)),
      }));
    return c.json({ ok: true, payload: { results } });
  });

  /** Fuzzy filename / path search over the session workspace (ripgrep `--files` + subsequence scoring). */
  authenticated.get('/api/workspace/editor/files/search', async (c) => {
    const q = typeof c.req.query('q') === 'string' ? c.req.query('q')!.trim() : '';
    const limitRaw = c.req.query('limit');
    const limit = Math.min(
      Math.max(parseInt(typeof limitRaw === 'string' ? limitRaw : '15', 10) || 15, 1),
      FILE_SEARCH_MAX_LIMIT,
    );

    const ws = await resolveEditorWorkspaceRootAsync(
      service,
      service.currentConfig,
      c.req.query('sessionKey'),
      c.req.query('agentId'),
    );
    if (ws.ok === false) {
      return c.json({ ok: false, error: { message: ws.message } }, 400);
    }

    const entries = await fuzzySearchWorkspaceFiles(ws.root, q, limit);
    return c.json({ ok: true, payload: { entries } });
  });
}
