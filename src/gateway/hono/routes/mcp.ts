import type { Hono } from 'hono';
import { discoverMcpTools } from '../../../agent/mcp/tool-catalog.js';
import { cancelMcpAuthorization, getMcpAuthorization, probeMcpConnection, startMcpAuthorization, submitMcpRedirect } from '../../../agent/mcp/connection-setup.js';
import { loadMergedMcpConfig } from '../../../agent/mcp/config.js';
import { getWorkspacePath } from '../../../config/workspace-path-helpers.js';
import { isManagedConnectorServer } from '../../../connectors/materialize.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';

export function registerMcpRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
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
      servers: Object.entries(merged.config.mcpServers).map(([id, server]) => ({ id, plugin: server.xopcPlugin,
        managed: isManagedConnectorServer(server),
        connectorId: isManagedConnectorServer(server) ? server.xopcConnector.connectorId : undefined,
      })).sort((a, b) => a.id.localeCompare(b.id)),
      mergedServerIds: Object.keys(merged.config.mcpServers).sort(), configured: cfg.mcp?.servers ?? {},
    } });
  });
}
