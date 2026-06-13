import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { copyFile, link, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { extractProfileAgentId } from '../../../config/agent-profile.js';
import { type Config } from '../../../config/schema.js';
import { getWorkspacePath } from '../../../config/workspace-path-helpers.js';
import { validateWritePath } from '../../../agent/sandbox/path-policy.js';
import { resolveSafeInboundFilePath } from '../../../channels/attachments/inbound-persist.js';
import { resolveSafeTtsFilePath } from '../../../channels/attachments/outbound-tts-persist.js';
import {
  listAgentEntries,
  normalizeAgentId,
  resolveAgentHomeDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from '../../../agent/agent-scope.js';
import { createGatewayRouteLogger, logRouteError } from '../lib/route-logger.js';
import { resolveHeartbeatMdPath } from '../../workspace-heartbeat-path.js';
import {
  isPathUnderWorkspace,
  resolveWorkspaceSafePath,
  toWorkspaceRelativePosix,
} from '../../workspace-editor-path.js';
import { listWorkspaceRelativeFilesFsFallback } from '../../workspace-fs-file-list.js';
import { runRipgrepInDirectory, runRipgrepListFiles } from '../../workspace-ripgrep.js';
import {
  buildFilePathClassifierContext,
  classifyFileLocation,
  displayNameForPath,
  fileRefSessionKeysMatch,
  resolveFileReferenceCandidate,
} from '../../file-path-classifier.js';
import {
  fileReferenceRegistry,
  type FileReferenceCapability,
  type FileReferenceLocationKind,
  type FileReferenceScope,
} from '../../file-reference-registry.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import type { GatewayService } from '../../service.js';

const log = createGatewayRouteLogger('Workspace');

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
      const root = await service.sessions.getEffectiveWorkspacePath(sk);
      return { ok: true, root };
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, sessionKey: sk }, 'Session workspace root resolution failed');
      return { ok: false, message: em || 'Session workspace resolution failed' };
    }
  }
  return resolveEditorWorkspaceRoot(cfg, agentIdRaw);
}

interface ResolvedWorkspaceImportConfig {
  targetDir: string;
  maxBytes: number;
  allowOverwrite: boolean;
}

function resolveWorkspaceImportConfig(cfg: Config): ResolvedWorkspaceImportConfig {
  const raw = cfg.workspace?.import;
  return {
    targetDir: raw?.targetDir?.trim() || 'imports',
    maxBytes: raw?.maxBytes ?? 104_857_600,
    allowOverwrite: raw?.allowOverwrite ?? true,
  };
}

/** Strip path separators, NULs and control chars from a basename so it stays in the destination dir. */
function sanitizeImportBasename(name: string): string {
  return name
    .replace(/[\\/]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
}

/**
 * Race-safe target picker for the `rename`-on-conflict strategy. Uses `link(tmp, target)`
 * which atomically fails with EEXIST when the candidate is taken; on success the tmp
 * file is left in place for the caller to unlink. Returns the linked target path.
 */
async function pickAvailableTargetWithLink(
  tmpAbs: string,
  initialDestAbs: string,
  maxAttempts = 1000,
): Promise<{ ok: true; path: string; attempts: number } | { ok: false; attempts: number }> {
  const dir = dirname(initialDestAbs);
  const original = basename(initialDestAbs);
  const dotIdx = original.lastIndexOf('.');
  const stem = dotIdx > 0 ? original.slice(0, dotIdx) : original;
  const ext = dotIdx > 0 ? original.slice(dotIdx) : '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = attempt === 1 ? initialDestAbs : join(dir, `${stem}-${attempt}${ext}`);
    try {
      await link(tmpAbs, candidate);
      return { ok: true, path: candidate, attempts: attempt };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') {
        throw err;
      }
    }
  }
  return { ok: false, attempts: maxAttempts };
}

function fileReferenceCapabilities(
  scope: FileReferenceScope,
  isDirectory: boolean,
  locationKind?: FileReferenceLocationKind,
): FileReferenceCapability[] {
  if (scope === 'workspace') {
    return isDirectory
      ? ['openExternal', 'revealInFolder', 'copyPath']
      : ['preview', 'edit', 'openExternal', 'revealInFolder', 'copyPath'];
  }
  if (scope === 'external' || scope === 'agent-profile' || scope === 'session-artifact') {
    const base: FileReferenceCapability[] = ['openExternal', 'revealInFolder', 'copyPath'];
    // v1: importToWorkspace for files only; exclude xopc-config to prevent copying
    // app config into the workspace (semantically wrong).
    if (!isDirectory && locationKind !== 'xopc-config') {
      base.push('importToWorkspace');
    }
    return base;
  }
  if (scope === 'missing') return ['copyPath'];
  return [];
}

function isFileReferenceAction(action: unknown): action is 'openExternal' | 'revealInFolder' {
  return action === 'openExternal' || action === 'revealInFolder';
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
          absolutePath: abs,
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

  authenticated.get('/api/workspace/editor/resolve-reference', async (c) => {
    const rawPath = typeof c.req.query('path') === 'string' ? c.req.query('path')!.trim() : '';
    if (!rawPath) {
      return c.json({ ok: false, error: { code: 'INVALID_PATH', message: 'Missing path' } }, 400);
    }

    const sessionKey = typeof c.req.query('sessionKey') === 'string' ? c.req.query('sessionKey')!.trim() : '';
    const ws = await resolveEditorWorkspaceRootAsync(
      service,
      service.currentConfig,
      sessionKey,
      c.req.query('agentId'),
    );
    if (ws.ok === false) {
      return c.json({ ok: false, error: { code: 'WORKSPACE_RESOLUTION_FAILED', message: ws.message } }, 400);
    }

    const workspaceRoot = ws.root;
    const classifierCtx = { ...buildFilePathClassifierContext(service.currentConfig, sessionKey), workspaceRoot };
    const displayName = displayNameForPath(rawPath);
    const { candidate, invalid } = await resolveFileReferenceCandidate(rawPath, workspaceRoot, classifierCtx);

    if (!candidate || invalid) {
      return c.json({
        ok: true,
        payload: {
          inputPath: rawPath,
          displayName,
          scope: 'invalid' satisfies FileReferenceScope,
          exists: false,
          capabilities: [] as FileReferenceCapability[],
          errorCode: 'INVALID_PATH',
        },
      });
    }

    let st: Awaited<ReturnType<typeof stat>> | null = null;
    try {
      st = await stat(candidate);
    } catch {
      st = null;
    }

    if (!st) {
      // Always include the resolved candidate so the UI's "Copy path" yields
      // something actionable ("I looked here, no file"). Without this, bare
      // workspace-relative mentions fall back to the `rel:<path>` UI sentinel.
      return c.json({
        ok: true,
        payload: {
          inputPath: rawPath,
          displayName,
          scope: 'missing' satisfies FileReferenceScope,
          exists: false,
          absolutePath: candidate,
          capabilities: fileReferenceCapabilities('missing', false),
          errorCode: 'FILE_NOT_FOUND',
        },
      });
    }

    const classified = classifyFileLocation(candidate, classifierCtx);
    const { scope, locationKind, manageRoute } = classified;
    const inWorkspace = scope === 'workspace';
    const isDirectory = st.isDirectory();
    const capabilities = fileReferenceCapabilities(scope, isDirectory, locationKind);
    const ref = fileReferenceRegistry.register({
      absolutePath: candidate,
      sessionKey: sessionKey || undefined,
      scope,
      locationKind,
      capabilities,
    });

    return c.json({
      ok: true,
      payload: {
        fileRefId: ref.id,
        inputPath: rawPath,
        displayName,
        scope,
        locationKind,
        manageRoute,
        exists: true,
        isDirectory,
        absolutePath: candidate,
        workspaceRelativePath: inWorkspace ? toWorkspaceRelativePosix(workspaceRoot, candidate) : undefined,
        capabilities,
        mtimeMs: st.mtimeMs,
      },
    });
  });

  authenticated.post('/api/workspace/file-ref/:id/resolve-action', async (c) => {
    const id = c.req.param('id')?.trim() ?? '';
    if (!id) {
      return c.json({ ok: false, error: { code: 'INVALID_FILE_REF', message: 'Missing file reference' } }, 400);
    }

    const ref = fileReferenceRegistry.resolve(id);
    if (!ref) {
      return c.json({ ok: false, error: { code: 'FILE_REF_EXPIRED', message: 'File reference expired' } }, 404);
    }

    const sessionKey = typeof c.req.query('sessionKey') === 'string' ? c.req.query('sessionKey')!.trim() : '';
    if (!fileRefSessionKeysMatch(ref.sessionKey, sessionKey)) {
      return c.json({ ok: false, error: { code: 'FILE_REF_FORBIDDEN', message: 'File reference forbidden' } }, 403);
    }

    const body = (await c.req.json().catch(() => ({}))) as { action?: unknown };
    const action = body.action;
    if (!isFileReferenceAction(action)) {
      return c.json({ ok: false, error: { code: 'INVALID_ACTION', message: 'Invalid action' } }, 400);
    }
    if (!ref.capabilities.includes(action)) {
      return c.json({ ok: false, error: { code: 'ACTION_NOT_ALLOWED', message: 'Action not allowed' } }, 403);
    }

    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(ref.absolutePath);
    } catch {
      return c.json({ ok: false, error: { code: 'FILE_NOT_FOUND', message: 'File not found' } }, 404);
    }

    return c.json({
      ok: true,
      payload: {
        absolutePath: ref.absolutePath,
        isDirectory: st.isDirectory(),
      },
    });
  });

  authenticated.post('/api/workspace/import-file-ref/:id', async (c) => {
    const id = c.req.param('id')?.trim() ?? '';
    if (!id) {
      return c.json({ ok: false, error: { code: 'INVALID_FILE_REF', message: 'Missing file reference' } }, 400);
    }

    const ref = fileReferenceRegistry.resolve(id);
    if (!ref) {
      return c.json({ ok: false, error: { code: 'FILE_REF_EXPIRED', message: 'File reference expired' } }, 404);
    }

    const sessionKey = typeof c.req.query('sessionKey') === 'string' ? c.req.query('sessionKey')!.trim() : '';
    if (!fileRefSessionKeysMatch(ref.sessionKey, sessionKey)) {
      return c.json({ ok: false, error: { code: 'FILE_REF_FORBIDDEN', message: 'File reference forbidden' } }, 403);
    }

    if (!ref.capabilities.includes('importToWorkspace')) {
      return c.json({ ok: false, error: { code: 'IMPORT_NOT_ALLOWED', message: 'Import not allowed for this file' } }, 403);
    }

    let sourceStat: Awaited<ReturnType<typeof stat>>;
    try {
      sourceStat = await stat(ref.absolutePath);
    } catch {
      fileReferenceRegistry.expireById(id);
      return c.json({ ok: false, error: { code: 'SOURCE_NOT_FOUND', message: 'Source file no longer exists' } }, 404);
    }
    if (!sourceStat.isFile()) {
      return c.json({ ok: false, error: { code: 'SOURCE_NOT_FILE', message: 'Source is not a regular file' } }, 400);
    }

    const importCfg = resolveWorkspaceImportConfig(service.currentConfig);
    if (sourceStat.size > importCfg.maxBytes) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'SOURCE_TOO_LARGE',
            message: `Source exceeds maximum import size (${importCfg.maxBytes} bytes)`,
          },
        },
        413,
      );
    }

    const ws = await resolveEditorWorkspaceRootAsync(service, service.currentConfig, sessionKey, undefined);
    if (ws.ok === false) {
      return c.json({ ok: false, error: { code: 'WORKSPACE_RESOLUTION_FAILED', message: ws.message } }, 400);
    }
    const workspaceRoot = ws.root;

    let body: { destination?: unknown; onConflict?: unknown };
    try {
      body = (await c.req.json().catch(() => ({}))) as typeof body;
    } catch {
      body = {};
    }
    const requestedDestRaw = typeof body.destination === 'string' ? body.destination.trim() : '';
    const onConflictRaw = typeof body.onConflict === 'string' ? body.onConflict : 'rename';
    if (onConflictRaw !== 'rename' && onConflictRaw !== 'overwrite' && onConflictRaw !== 'error') {
      return c.json({ ok: false, error: { code: 'INVALID_CONFLICT_MODE', message: 'Invalid onConflict value' } }, 400);
    }
    const onConflict = onConflictRaw as 'rename' | 'overwrite' | 'error';
    if (onConflict === 'overwrite' && !importCfg.allowOverwrite) {
      return c.json({ ok: false, error: { code: 'OVERWRITE_DISABLED', message: 'Overwrite is disabled by config' } }, 403);
    }

    const sourceBasename = sanitizeImportBasename(basename(ref.absolutePath)) || 'imported-file';
    let requestedRel: string;
    if (!requestedDestRaw) {
      requestedRel = `${importCfg.targetDir}/${sourceBasename}`;
    } else {
      const trimmedDest = requestedDestRaw.replace(/\\/g, '/');
      // Path ending with `/` is treated as a directory; append source basename.
      requestedRel = trimmedDest.endsWith('/') ? `${trimmedDest}${sourceBasename}` : trimmedDest;
    }

    let initialDestAbs = resolveWorkspaceSafePath(workspaceRoot, requestedRel);
    if (!initialDestAbs) {
      return c.json({ ok: false, error: { code: 'INVALID_DESTINATION', message: 'Invalid destination path' } }, 400);
    }

    // Sandbox: blocks `.xopc/xopc.json`, `.env*`, etc.; canonical symlink resolution included.
    const writePolicy = validateWritePath(initialDestAbs, workspaceRoot);
    if (!writePolicy.allowed) {
      return c.json({ ok: false, error: { code: 'DESTINATION_BLOCKED', message: writePolicy.reason ?? 'Destination blocked' } }, 403);
    }

    if (resolve(ref.absolutePath) === resolve(initialDestAbs)) {
      return c.json({ ok: false, error: { code: 'SAME_LOCATION', message: 'Destination is the same as source' } }, 400);
    }

    const destDir = dirname(initialDestAbs);
    try {
      await mkdir(destDir, { recursive: true });
    } catch (err) {
      log.warn({ err, destDir }, 'Failed to create import destination directory');
      return c.json({ ok: false, error: { code: 'IMPORT_FAILED', message: 'Failed to prepare destination' } }, 500);
    }

    // Stage source into a hidden tmp file inside the destination directory so we
    // can atomically `link` (rename strategy) or `rename` (overwrite) to land it.
    const tmpName = `.${basename(initialDestAbs)}.import-${randomUUID()}.tmp`;
    const tmpAbs = join(destDir, tmpName);

    const started = Date.now();
    let renamed = false;
    let overwrote = false;
    let finalDestAbs = initialDestAbs;

    try {
      try {
        await copyFile(ref.absolutePath, tmpAbs, fsConstants.COPYFILE_FICLONE);
      } catch (err) {
        await unlink(tmpAbs).catch(() => {});
        log.warn({ err, source: ref.absolutePath, tmpAbs }, 'Failed to copy source into staging tmp');
        return c.json({ ok: false, error: { code: 'IMPORT_FAILED', message: 'Failed to copy source file' } }, 500);
      }

      if (onConflict === 'overwrite') {
        // Snapshot pre-rename existence for telemetry; the actual overwrite is unconditional.
        overwrote = await stat(initialDestAbs).then(() => true).catch(() => false);
        try {
          await rename(tmpAbs, initialDestAbs);
        } catch (err) {
          await unlink(tmpAbs).catch(() => {});
          log.warn({ err, target: initialDestAbs }, 'Atomic rename failed');
          return c.json({ ok: false, error: { code: 'IMPORT_FAILED', message: 'Failed to finalize import' } }, 500);
        }
      } else if (onConflict === 'error') {
        const exists = await stat(initialDestAbs).then(() => true).catch(() => false);
        if (exists) {
          await unlink(tmpAbs).catch(() => {});
          return c.json({ ok: false, error: { code: 'DESTINATION_EXISTS', message: 'Destination already exists' } }, 409);
        }
        try {
          await link(tmpAbs, initialDestAbs);
          await unlink(tmpAbs).catch(() => {});
        } catch (err) {
          await unlink(tmpAbs).catch(() => {});
          log.warn({ err, target: initialDestAbs }, 'Hard link to destination failed');
          return c.json({ ok: false, error: { code: 'IMPORT_FAILED', message: 'Failed to finalize import' } }, 500);
        }
      } else {
        // rename: race-safe loop using O_EXCL semantics of `link`.
        const picked = await pickAvailableTargetWithLink(tmpAbs, initialDestAbs);
        if (!picked.ok) {
          await unlink(tmpAbs).catch(() => {});
          log.warn({ target: initialDestAbs, attempts: picked.attempts }, 'Failed to find free import target name');
          return c.json({ ok: false, error: { code: 'IMPORT_FAILED', message: 'No free destination name available' } }, 500);
        }
        await unlink(tmpAbs).catch(() => {});
        finalDestAbs = picked.path;
        renamed = picked.path !== initialDestAbs;
      }
    } catch (err) {
      await unlink(tmpAbs).catch(() => {});
      log.error({ err }, 'Import file unexpected failure');
      return c.json({ ok: false, error: { code: 'IMPORT_FAILED', message: 'Import failed' } }, 500);
    }

    let finalMtime: number;
    try {
      finalMtime = (await stat(finalDestAbs)).mtimeMs;
    } catch {
      finalMtime = Date.now();
    }

    const workspaceRel = toWorkspaceRelativePosix(workspaceRoot, finalDestAbs);

    fileReferenceRegistry.expireById(id);
    const newRef = fileReferenceRegistry.register({
      absolutePath: finalDestAbs,
      sessionKey: sessionKey || undefined,
      scope: 'workspace',
      capabilities: fileReferenceCapabilities('workspace', false),
    });

    const sourceScope = ref.scope;
    const sourceLocationKind = ref.locationKind;

    service.emit('workspace.file-imported', {
      sessionKey: sessionKey || undefined,
      workspaceRelativePath: workspaceRel,
      absolutePath: finalDestAbs,
      bytes: sourceStat.size,
      sourceScope,
      sourceLocationKind,
    });

    log.info(
      {
        sessionKey,
        fileRefId: id,
        sourceAbsolutePath: ref.absolutePath,
        sourceScope,
        sourceLocationKind,
        destWorkspaceRelativePath: workspaceRel,
        bytes: sourceStat.size,
        renamed,
        overwrote,
        durationMs: Date.now() - started,
      },
      'Workspace file import succeeded',
    );

    return c.json({
      ok: true,
      payload: {
        workspaceRelativePath: workspaceRel,
        absolutePath: finalDestAbs,
        bytesCopied: sourceStat.size,
        sourceAbsolutePath: ref.absolutePath,
        sourceScope,
        sourceLocationKind,
        renamed,
        overwrote,
        mtimeMs: finalMtime,
        newFileRefId: newRef.id,
      },
    });
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
