import type { Context, Hono } from 'hono';
import { McpConnectionDrafts, McpDraftError, mcpConfigRevision } from '../../../agent/mcp/connection-drafts.js';
import { withGatewayConfigWriteLock } from '../lib/config-write-lock.js';
import { discoverMcpTools } from '../../../agent/mcp/tool-catalog.js';
import { cancelMcpAuthorization, getMcpAuthorization, probeMcpConnection, startMcpAuthorization, submitMcpRedirect } from '../../../agent/mcp/connection-setup.js';
import { loadMergedMcpConfig } from '../../../agent/mcp/config.js';
import { getWorkspacePath } from '../../../config/workspace-path-helpers.js';
import { isManagedConnectorServer } from '../../../connectors/materialize.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';

export function registerMcpRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const drafts = new McpConnectionDrafts({ readConfig: () => deps.service.currentConfig, saveConfig: (config, expected) => deps.service.saveConfig(config, expected) });
  const owner = (c: Context) => getGatewayPrincipal(c).principalId;
  const draftRoute = (handler: (c: Context) => Promise<unknown> | unknown) => async (c: Context) => {
    try { return c.json({ ok: true, payload: await handler(c) }); }
    catch (error) {
      return c.json({ ok: false, error: error instanceof McpDraftError ? error.message : 'MCP draft operation failed.' }, error instanceof McpDraftError ? error.status : 500);
    }
  };
  app.post('/api/mcp/drafts', deps.strictRateLimitMiddleware, draftRoute(async c => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.serverId !== 'string' || body.sourceServerId !== undefined && typeof body.sourceServerId !== 'string') throw new McpDraftError(400, 'Invalid MCP draft request.');
    return drafts.create(owner(c), body);
  }));
  app.post('/api/mcp/drafts/:id/probe', deps.strictRateLimitMiddleware, draftRoute(c => drafts.probe(owner(c), c.req.param('id'))));
  app.post('/api/mcp/drafts/:id/auth', deps.strictRateLimitMiddleware, draftRoute(c => drafts.authorize(owner(c), c.req.param('id'))));
  app.get('/api/mcp/drafts/:id/auth', draftRoute(c => drafts.authorization(owner(c), c.req.param('id'))));
  app.delete('/api/mcp/drafts/:id/auth', draftRoute(c => drafts.cancelAuthorization(owner(c), c.req.param('id'))));
  app.post('/api/mcp/drafts/:id/auth/redirect', deps.strictRateLimitMiddleware, draftRoute(async c => {
    const body = await c.req.json().catch(() => null);
    if (typeof body?.url !== 'string' || body.url.length >= 16_384) throw new McpDraftError(400, 'Invalid callback address.');
    drafts.redirect(owner(c), c.req.param('id'), body.url);
  }));
  app.post('/api/mcp/drafts/:id/commit', deps.strictRateLimitMiddleware, draftRoute(async c => {
    const body = await c.req.json().catch(() => null);
    if (!body || body.enable !== undefined && typeof body.enable !== 'boolean') throw new McpDraftError(400, 'Invalid commit request.');
    return withGatewayConfigWriteLock(deps.service, () => drafts.commit(owner(c), c.req.param('id'), body.enable === true));
  }));
  app.get('/api/mcp/drafts/:id/tools', deps.strictRateLimitMiddleware, draftRoute(async c => ({ tools: await drafts.tools(owner(c), c.req.param('id')) })));
  app.delete('/api/mcp/drafts/:id', draftRoute(c => drafts.remove(owner(c), c.req.param('id'))));

  app.delete('/api/mcp/servers/:id', deps.strictRateLimitMiddleware, draftRoute(async c => {
    const body = await c.req.json().catch(() => null);
    if (!body?.expectedServer || typeof body.expectedServer !== 'object' || Array.isArray(body.expectedServer)) throw new McpDraftError(400, 'The expected server configuration is required.');
    return withGatewayConfigWriteLock(deps.service, async () => {
      const current = deps.service.currentConfig, id = c.req.param('id');
      const server = Object.hasOwn(current.mcp?.servers ?? {}, id) ? current.mcp?.servers?.[id] : undefined;
      if (!server || isManagedConnectorServer(server) || mcpConfigRevision(server) !== mcpConfigRevision(body.expectedServer)) throw new McpDraftError(409, 'The custom server changed. Reload before removing it.');
      const next = structuredClone(current); delete next.mcp!.servers![id];
      const result = await deps.service.saveConfig(next, structuredClone(current));
      if (result.conflict) throw new McpDraftError(409, 'Configuration changed before removing the server.');
      if (!result.saved && !result.persisted) throw new McpDraftError(500, 'Could not remove the server.');
      return { serverId: id, ...(!result.saved ? { reloadRequired: true } : {}) };
    });
  }));
  app.post('/api/mcp/servers/:id/probe', deps.strictRateLimitMiddleware, async c => {
    const config = deps.service.currentConfig;
    const id = c.req.param('id');
    if (!Object.hasOwn(config.mcp?.servers ?? {}, id)) return c.json({ ok: false, error: 'MCP server not found.' }, 404);
    const result = await probeMcpConnection(config, getWorkspacePath(config) || process.cwd(), id);
    return c.json({ ok: true, payload: result });
  });
  app.post('/api/mcp/servers/:id/auth', deps.strictRateLimitMiddleware, async c => {
    const config = deps.service.currentConfig;
    const id = c.req.param('id');
    if (!Object.hasOwn(config.mcp?.servers ?? {}, id)) return c.json({ ok: false, error: 'MCP server not found.' }, 404);
    try {
      const attempt = startMcpAuthorization(config, getWorkspacePath(config) || process.cwd(), id, getGatewayPrincipal(c).principalId);
      return c.json({ ok: true, payload: attempt });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.get('/api/mcp/auth/:id', c => {
    const attempt = getMcpAuthorization(c.req.param('id'), getGatewayPrincipal(c).principalId, deps.service.currentConfig);
    return attempt ? c.json({ ok: true, payload: attempt }) : c.json({ ok: false, error: 'Sign-in not found or expired.' }, 404);
  });
  app.post('/api/mcp/auth/:id/redirect', deps.strictRateLimitMiddleware, async c => {
    const body = await c.req.json().catch(() => null);
    try {
      const accepted = typeof body?.url === 'string' && body.url.length < 16_384
        && submitMcpRedirect(c.req.param('id'), getGatewayPrincipal(c).principalId, body.url, deps.service.currentConfig);
      return accepted ? c.json({ ok: true }) : c.json({ ok: false, error: 'The callback address does not match this sign-in.' }, 400);
    } catch {
      return c.json({ ok: false, error: 'Invalid callback address.' }, 400);
    }
  });
  app.delete('/api/mcp/auth/:id', c => {
    const cancelled = cancelMcpAuthorization(c.req.param('id'), getGatewayPrincipal(c).principalId);
    return cancelled ? c.json({ ok: true }) : c.json({ ok: false, error: 'Sign-in not found.' }, 404);
  });
  app.post('/api/mcp/servers/:id/tools', deps.strictRateLimitMiddleware, async c => {
    const cfg = deps.service.currentConfig;
    const id = c.req.param('id');
    if (!Object.hasOwn(cfg.mcp?.servers ?? {}, id)) {
      return c.json({ ok: false, error: 'MCP server not found.' }, 404);
    }
    try {
      const tools = await discoverMcpTools(cfg, getWorkspacePath(cfg) || process.cwd(), id);
      return c.json({ ok: true, payload: { serverId: id, tools } });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 502);
    }
  });
  app.get('/api/mcp/servers', c => {
    const cfg = deps.service.currentConfig;
    const merged = loadMergedMcpConfig({ workspaceDir: getWorkspacePath(cfg) || './workspace', cfg });
    return c.json({ ok: true, payload: {
      servers: Object.entries(merged.config.mcpServers).map(([id, server]) => {
        const { xopcConnectionCheck, ...configuration } = server;
        const check = xopcConnectionCheck as { revision?: string; checkedAt?: string; toolCount?: number } | undefined;
        return { id, plugin: server.xopcPlugin,
        lastCheck: check?.revision === mcpConfigRevision(configuration) ? { checkedAt: check.checkedAt, toolCount: check.toolCount } : undefined,
        managed: isManagedConnectorServer(server),
        connectorId: isManagedConnectorServer(server) ? server.xopcConnector.connectorId : undefined,
      }; }).sort((a, b) => a.id.localeCompare(b.id)),
      mergedServerIds: Object.keys(merged.config.mcpServers).sort(), configured: cfg.mcp?.servers ?? {},
    } });
  });
}
