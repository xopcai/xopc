import type { Hono } from 'hono';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { extractToken } from '../../auth.js';
import { getClientIpFromHeaders } from '../../auth-rate-limit.js';
import { getShareStore } from '../../../share/share-store.js';
import { resolveShareUrl } from '../../../share/share-url.js';
import { consumeSharePublicLimit } from '../../../share/share-rate-limit.js';
import { logShareAudit } from '../../../share/share-audit.js';
import { renderShareLandingPage, renderShareExpiredPage } from '../../../share/share-landing.js';
import type { ShareExpiredReason } from '../../../share/share-landing.js';
import type { ShareConfig } from '../../../share/share-types.js';
import { SHARE_CONFIG_DEFAULTS } from '../../../share/share-types.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import type { GatewayService } from '../../service.js';

function getShareUrlContext(service: GatewayService) {
  const gateway = service.currentConfig.gateway;
  return {
    gatewayHost: gateway.host ?? '127.0.0.1',
    gatewayPort: gateway.port ?? 18790,
  };
}

function resolveShareConfig(service: GatewayService): Partial<ShareConfig> {
  const raw = (service.currentConfig.gateway as Record<string, unknown>)?.share;
  if (!raw || typeof raw !== 'object') return {};
  return raw as Partial<ShareConfig>;
}

function hashGatewayToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 12);
}

const MAX_CONCURRENT_DOWNLOADS_PER_TOKEN = 5;
const activeDownloads = new Map<string, number>();

function acquireDownloadSlot(token: string): boolean {
  const current = activeDownloads.get(token) ?? 0;
  if (current >= MAX_CONCURRENT_DOWNLOADS_PER_TOKEN) return false;
  activeDownloads.set(token, current + 1);
  return true;
}

function releaseDownloadSlot(token: string): void {
  const current = activeDownloads.get(token) ?? 0;
  if (current <= 1) {
    activeDownloads.delete(token);
  } else {
    activeDownloads.set(token, current - 1);
  }
}

// ── Public routes (no auth required) ──────────────────────────────────────────

export function registerSharePublicRoutes(app: Hono, service: GatewayService): void {
  const store = getShareStore(resolveShareConfig(service));

  /** Landing page — does NOT consume viewCount (prevents link unfurl from wasting views). */
  app.get('/s/:token', async (c) => {
    const clientIp = getClientIpFromHeaders({ get: (n: string) => c.req.header(n) ?? undefined });
    const rateResult = consumeSharePublicLimit(clientIp);
    if (!rateResult.allowed) {
      c.header('Retry-After', String(Math.ceil(rateResult.retryAfterMs / 1000)));
      return c.text('Too many requests', 429);
    }

    const token = c.req.param('token');
    const record = store.getByToken(token);

    if (!record) {
      return c.html(renderShareExpiredPage('not_found'), 404);
    }

    const validation = store.validateAccess(record);
    if (!validation.valid) {
      logShareAudit(
        'share.access_denied',
        { shareId: record.id, tokenPrefix: token.slice(0, 8), reason: validation.reason, clientIp },
        `Share access denied: ${validation.reason}`,
      );
      return c.html(renderShareExpiredPage(validation.reason as ShareExpiredReason), 410);
    }

    // Direct download shortcut: ?dl=1
    if (c.req.query('dl') === '1') {
      return handleDownload(c, store, record, clientIp);
    }

    // Inline preview for whitelisted MIME types: ?inline=1
    if (c.req.query('inline') === '1') {
      const cfg = { ...SHARE_CONFIG_DEFAULTS, ...resolveShareConfig(service) };
      if (cfg.inlinePreviewMimes.includes(record.mimeType)) {
        return handleDownload(c, store, record, clientIp, true);
      }
    }

    const downloadPath = `/s/${token}/download`;
    return c.html(renderShareLandingPage(record, downloadPath));
  });

  /** Actual file download — consumes viewCount. */
  app.post('/s/:token/download', async (c) => {
    const clientIp = getClientIpFromHeaders({ get: (n: string) => c.req.header(n) ?? undefined });
    const rateResult = consumeSharePublicLimit(clientIp);
    if (!rateResult.allowed) {
      c.header('Retry-After', String(Math.ceil(rateResult.retryAfterMs / 1000)));
      return c.text('Too many requests', 429);
    }

    const token = c.req.param('token');
    const record = store.getByToken(token);

    if (!record) {
      return c.html(renderShareExpiredPage('not_found'), 404);
    }

    const validation = store.validateAccess(record);
    if (!validation.valid) {
      logShareAudit(
        'share.access_denied',
        { shareId: record.id, tokenPrefix: token.slice(0, 8), reason: validation.reason, clientIp },
        `Share download denied: ${validation.reason}`,
      );
      return c.html(renderShareExpiredPage(validation.reason as ShareExpiredReason), 410);
    }

    return handleDownload(c, store, record, clientIp);
  });

  /** File metadata (for link preview cards). */
  app.get('/s/:token/meta', async (c) => {
    const clientIp = getClientIpFromHeaders({ get: (n: string) => c.req.header(n) ?? undefined });
    const rateResult = consumeSharePublicLimit(clientIp);
    if (!rateResult.allowed) {
      c.header('Retry-After', String(Math.ceil(rateResult.retryAfterMs / 1000)));
      return c.text('Too many requests', 429);
    }

    const token = c.req.param('token');
    const record = store.getByToken(token);
    if (!record) {
      return c.json({ valid: false }, 404);
    }

    const validation = store.validateAccess(record);
    const remainingViews = record.maxViews !== null ? Math.max(0, record.maxViews - record.viewCount) : null;

    return c.json({
      fileName: record.fileName,
      fileSize: record.fileSize,
      mimeType: record.mimeType,
      description: record.description ?? null,
      expiresAt: record.expiresAt,
      remainingViews,
      valid: validation.valid,
    });
  });

  /** HEAD check (Hono uses .on() for HEAD method). */
  app.on('HEAD', '/s/:token', async (c) => {
    const token = c.req.param('token');
    const record = store.getByToken(token);
    if (!record) return c.body(null, 404);
    const validation = store.validateAccess(record);
    return c.body(null, validation.valid ? 200 : 410);
  });
}

// ── Authenticated routes ──────────────────────────────────────────────────────

export function registerShareRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  const store = getShareStore(resolveShareConfig(service));

  /** Create a share. */
  authenticated.post('/api/shares', async (c) => {
    const gatewayToken = extractToken({ authorization: c.req.header('authorization') ?? undefined });
    if (!gatewayToken) return c.json({ ok: false, error: { message: 'Token required' } }, 401);

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }

    const path = typeof body.path === 'string' ? body.path.trim() : '';
    if (!path) {
      return c.json({ ok: false, error: { message: 'Missing path' } }, 400);
    }

    const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : undefined;
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : undefined;

    // Resolve workspace root (same logic as workspace editor routes)
    const workspaceRoot = await resolveWorkspaceRootForShare(service, sessionKey, agentId);
    if (!workspaceRoot) {
      return c.json({ ok: false, error: { message: 'Workspace not configured' } }, 400);
    }

    const ttlMs = typeof body.ttlMs === 'number' ? body.ttlMs : undefined;
    const maxViews = body.maxViews === null ? null : typeof body.maxViews === 'number' ? body.maxViews : undefined;
    const description = typeof body.description === 'string' ? body.description.trim() || undefined : undefined;

    try {
      store.updateConfig(resolveShareConfig(service));
      const record = await store.create({
        path,
        ttlMs,
        maxViews,
        description,
        sessionKey,
        agentId,
        workspaceRoot,
        gatewayTokenHash: hashGatewayToken(gatewayToken),
      });

      const urlCtx = getShareUrlContext(service);
      const resolved = resolveShareUrl(record.token, urlCtx);

      return c.json({
        ok: true,
        payload: {
          id: record.id,
          token: record.token,
          shareUrl: resolved.shareUrl,
          lanUrl: resolved.lanUrl,
          reachability: resolved.reachability,
          reachabilityHint: resolved.reachabilityHint,
          expiresAt: record.expiresAt,
          maxViews: record.maxViews,
          fileName: record.fileName,
          fileSize: record.fileSize,
        },
      }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 400);
    }
  });

  /** List all shares. */
  authenticated.get('/api/shares', async (c) => {
    store.updateConfig(resolveShareConfig(service));
    const shares = store.getAllShares();
    const urlCtx = getShareUrlContext(service);
    const now = Date.now();

    const items = shares.map((r) => {
      const resolved = resolveShareUrl(r.token, urlCtx);
      const expired = now >= new Date(r.expiresAt).getTime();
      return {
        id: r.id,
        fileName: r.fileName,
        workspaceRelativePath: r.workspaceRelativePath,
        shareUrl: resolved.shareUrl,
        reachability: resolved.reachability,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        viewCount: r.viewCount,
        maxViews: r.maxViews,
        revoked: r.revoked,
        expired,
        description: r.description ?? null,
        fileSize: r.fileSize,
        mimeType: r.mimeType,
      };
    });

    return c.json({ ok: true, payload: { shares: items } });
  });

  /** Get single share details. */
  authenticated.get('/api/shares/:id', async (c) => {
    const id = c.req.param('id');
    const record = store.getById(id);
    if (!record) return c.json({ ok: false, error: { message: 'Not found' } }, 404);

    const urlCtx = getShareUrlContext(service);
    const resolved = resolveShareUrl(record.token, urlCtx);
    const expired = Date.now() >= new Date(record.expiresAt).getTime();

    return c.json({
      ok: true,
      payload: {
        ...record,
        token: undefined,
        shareUrl: resolved.shareUrl,
        lanUrl: resolved.lanUrl,
        reachability: resolved.reachability,
        expired,
      },
    });
  });

  /** Revoke a share. */
  authenticated.delete('/api/shares/:id', async (c) => {
    const id = c.req.param('id');
    const success = store.revoke(id);
    if (!success) return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    return c.json({ ok: true });
  });

  /** Batch revoke. */
  authenticated.delete('/api/shares', async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      /* empty body = no-op */
    }

    if (body.expired === true) {
      const count = store.revokeExpired();
      return c.json({ ok: true, payload: { revokedCount: count } });
    }

    const ids = Array.isArray(body.ids) ? (body.ids as string[]).filter((x) => typeof x === 'string') : [];
    if (ids.length === 0) {
      return c.json({ ok: false, error: { message: 'Provide ids array or expired: true' } }, 400);
    }
    const count = store.revokeMany(ids);
    return c.json({ ok: true, payload: { revokedCount: count } });
  });

  /** Update a share (extend TTL or change maxViews). */
  authenticated.patch('/api/shares/:id', async (c) => {
    const id = c.req.param('id');
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }

    const patch: { extendTtlMs?: number; maxViews?: number | null } = {};
    if (typeof body.extendTtlMs === 'number') patch.extendTtlMs = body.extendTtlMs;
    if (body.maxViews === null || typeof body.maxViews === 'number') patch.maxViews = body.maxViews as number | null;

    const updated = store.update(id, patch);
    if (!updated) return c.json({ ok: false, error: { message: 'Not found' } }, 404);

    const urlCtx = getShareUrlContext(service);
    const resolved = resolveShareUrl(updated.token, urlCtx);

    return c.json({
      ok: true,
      payload: {
        id: updated.id,
        expiresAt: updated.expiresAt,
        maxViews: updated.maxViews,
        shareUrl: resolved.shareUrl,
      },
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveWorkspaceRootForShare(
  service: GatewayService,
  sessionKey: string | undefined,
  agentId: string | undefined,
): Promise<string | null> {
  const cfg = service.currentConfig;

  if (sessionKey) {
    try {
      return await service.getEffectiveWorkspacePathForSession(sessionKey);
    } catch {
      /* fall through to agentId */
    }
  }

  // Import dynamically to avoid circular dependency at module load time
  const { getWorkspacePath } = await import('../../../config/schema.js');
  const { resolveAgentWorkspaceDir, normalizeAgentId, resolveDefaultAgentId } = await import(
    '../../../agent/agent-scope.js'
  );

  if (agentId) {
    const normalized = normalizeAgentId(agentId);
    return resolveAgentWorkspaceDir(cfg, normalized);
  }

  const root = getWorkspacePath(cfg);
  if (root) return root;

  const defaultId = resolveDefaultAgentId(cfg);
  return resolveAgentWorkspaceDir(cfg, defaultId);
}

async function handleDownload(
  c: { header: (n: string, v: string) => void; body: (b: unknown, s?: number) => Response },
  store: ReturnType<typeof getShareStore>,
  record: ReturnType<ReturnType<typeof getShareStore>['getByToken']> & {},
  clientIp: string,
  inline = false,
): Promise<Response> {
  // Concurrency check
  if (!acquireDownloadSlot(record.token)) {
    return c.body('Too many concurrent downloads for this share', 429) as unknown as Response;
  }

  try {
    // File integrity check (inode + path)
    const integrity = await store.validateFileIntegrity(record);
    if (!integrity.valid) {
      logShareAudit(
        'share.access_denied',
        { shareId: record.id, tokenPrefix: record.token.slice(0, 8), reason: integrity.reason, clientIp },
        `Share file integrity check failed: ${integrity.reason}`,
      );
      const { renderShareExpiredPage: render } = await import('../../../share/share-landing.js');
      return new Response(render(integrity.reason as ShareExpiredReason), {
        status: 410,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Consume viewCount
    store.incrementViewCount(record.id);

    logShareAudit(
      'share.access',
      { shareId: record.id, tokenPrefix: record.token.slice(0, 8), clientIp, viewCount: record.viewCount },
      `Share downloaded: ${record.fileName}`,
    );

    // Stream file
    const fileStat = await stat(record.absolutePath);
    const stream = createReadStream(record.absolutePath);
    const webStream = Readable.toWeb(stream) as ReadableStream;

    const disposition = inline ? `inline; filename="${encodeURIComponent(record.fileName)}"` : `attachment; filename="${encodeURIComponent(record.fileName)}"`;

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': record.mimeType,
        'Content-Disposition': disposition,
        'Content-Length': String(fileStat.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } finally {
    releaseDownloadSlot(record.token);
  }
}
