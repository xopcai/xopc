import type { Hono } from 'hono';
import { createHash } from 'node:crypto';

import { extractToken } from '../../auth.js';
import { getSiteShareStore } from '../../../share/site-share-store.js';
import { resolveSiteShareConfig } from '../../../share/site-share-config.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { resolveGatewayEffectiveHost } from '../../../config/gateway-bind.js';

function hashGatewayToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 12);
}

function buildShareUrls(
  record: import('../../../share/site-share-types.js').SiteShareRecord,
  publicHostSuffix: string,
  gatewayHost: string,
  gatewayPort: number,
): { publicUrl: string; subpathUrl: string } {
  const label = record.subdomain ?? record.token;
  const publicUrl = `https://${label}.${publicHostSuffix}/`;
  const subpathUrl = `http://${gatewayHost}:${gatewayPort}/site/${record.token}/`;
  return { publicUrl, subpathUrl };
}

export function registerSiteShareRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  const store = getSiteShareStore(resolveSiteShareConfig(service));

  async function resolveWorkspaceRoot(
    sessionKey: string | undefined,
    agentId: string | undefined,
  ): Promise<string | null> {
    const cfg = service.currentConfig;
    if (sessionKey) {
      try {
        return await service.sessions.getEffectiveWorkspacePath(sessionKey);
      } catch {
        /* fall through */
      }
    }
    const { getWorkspacePath } = await import('../../../config/workspace-path-helpers.js');
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

  authenticated.post('/api/site-shares', async (c) => {
    const gatewayToken = extractToken({ authorization: c.req.header('authorization') ?? undefined });
    if (!gatewayToken) return c.json({ ok: false, error: { message: 'Token required' } }, 401);

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }

    const kind = body.kind === 'static' || body.kind === 'proxy' ? body.kind : null;
    if (!kind) return c.json({ ok: false, error: { message: "kind must be 'static' or 'proxy'" } }, 400);

    const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : undefined;
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : undefined;
    const path = typeof body.path === 'string' ? body.path.trim() : undefined;
    const upstreamUrl = typeof body.upstreamUrl === 'string' ? body.upstreamUrl.trim() : undefined;
    const ttlMs = typeof body.ttlMs === 'number' ? body.ttlMs : undefined;
    const description = typeof body.description === 'string' ? body.description.trim() || undefined : undefined;
    const subdomain = typeof body.subdomain === 'string' ? body.subdomain.trim() || undefined : undefined;
    const maxRequests =
      body.maxRequests === null
        ? null
        : typeof body.maxRequests === 'number'
        ? body.maxRequests
        : undefined;
    const spaFallback = typeof body.spaFallback === 'boolean' ? body.spaFallback : undefined;
    const rewriteMode =
      body.rewriteMode === 'none' || body.rewriteMode === 'html-only' || body.rewriteMode === 'html-css'
        ? body.rewriteMode
        : undefined;
    const forwardWebSocket = typeof body.forwardWebSocket === 'boolean' ? body.forwardWebSocket : undefined;

    let workspaceRoot: string | null = null;
    if (kind === 'static') {
      workspaceRoot = await resolveWorkspaceRoot(sessionKey, agentId);
      if (!workspaceRoot) {
        return c.json({ ok: false, error: { message: 'Workspace not configured' } }, 400);
      }
    }

    try {
      store.updateConfig(resolveSiteShareConfig(service));
      const record = await store.create({
        kind,
        path,
        upstreamUrl,
        ttlMs,
        description,
        subdomain,
        maxRequests,
        spaFallback,
        rewriteMode,
        forwardWebSocket,
        sessionKey,
        agentId,
        workspaceRoot,
        gatewayTokenHash: hashGatewayToken(gatewayToken),
      });

      const cfg = store.getConfig();
      const gw = service.currentConfig.gateway;
      const urls = buildShareUrls(record, cfg.publicHostSuffix, resolveGatewayEffectiveHost(service.currentConfig), gw.port ?? 18790);

      return c.json(
        {
          ok: true,
          payload: {
            id: record.id,
            token: record.token,
            subdomain: record.subdomain,
            kind: record.source.kind,
            createdAt: record.createdAt,
            expiresAt: record.expiresAt,
            description: record.description ?? null,
            maxRequests: record.maxRequests,
            publicUrl: urls.publicUrl,
            subpathUrl: urls.subpathUrl,
          },
        },
        201,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 400);
    }
  });

  authenticated.get('/api/site-shares', (c) => {
    store.updateConfig(resolveSiteShareConfig(service));
    const cfg = store.getConfig();
    const gw = service.currentConfig.gateway;
    const gatewayHost = resolveGatewayEffectiveHost(service.currentConfig);
    const gatewayPort = gw.port ?? 18790;
    const items = store.getAllShares().map((r) => {
      const urls = buildShareUrls(r, cfg.publicHostSuffix, gatewayHost, gatewayPort);
      const expired = Date.now() >= new Date(r.expiresAt).getTime();
      return {
        id: r.id,
        token: r.token,
        subdomain: r.subdomain,
        kind: r.source.kind,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        revoked: r.revoked,
        expired,
        description: r.description ?? null,
        requestCount: r.requestCount,
        uniqueClientCount: r.uniqueClientCount,
        maxRequests: r.maxRequests,
        source: r.source,
        publicUrl: urls.publicUrl,
        subpathUrl: urls.subpathUrl,
      };
    });
    return c.json({ ok: true, payload: { shares: items } });
  });

  authenticated.get('/api/site-shares/:id', (c) => {
    const id = c.req.param('id');
    const record = store.getById(id);
    if (!record) return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    const cfg = store.getConfig();
    const gw = service.currentConfig.gateway;
    const urls = buildShareUrls(record, cfg.publicHostSuffix, resolveGatewayEffectiveHost(service.currentConfig), gw.port ?? 18790);
    return c.json({
      ok: true,
      payload: {
        ...record,
        ...urls,
        expired: Date.now() >= new Date(record.expiresAt).getTime(),
      },
    });
  });

  authenticated.delete('/api/site-shares/:id', (c) => {
    const id = c.req.param('id');
    const ok = store.revoke(id);
    if (!ok) return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    return c.json({ ok: true });
  });

  authenticated.delete('/api/site-shares', async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      /* empty */
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

  authenticated.patch('/api/site-shares/:id', async (c) => {
    const id = c.req.param('id');
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const patch: { extendTtlMs?: number; maxRequests?: number | null } = {};
    if (typeof body.extendTtlMs === 'number') patch.extendTtlMs = body.extendTtlMs;
    if (body.maxRequests === null || typeof body.maxRequests === 'number') {
      patch.maxRequests = body.maxRequests as number | null;
    }
    const updated = store.update(id, patch);
    if (!updated) return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    return c.json({ ok: true, payload: { id: updated.id, expiresAt: updated.expiresAt, maxRequests: updated.maxRequests } });
  });
}
