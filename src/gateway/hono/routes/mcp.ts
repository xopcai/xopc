import type { Hono } from 'hono';

import {
  listBundleMcpResourcesForGateway,
  listBundleMcpServerCapabilitiesForGateway,
  listBundleMcpServerToolsForGateway,
} from '../../../agent/mcp/bundle-mcp-gateway.js';
import { loadMergedBundleMcpConfig } from '../../../agent/mcp/bundle-mcp-config.js';
import { getMcpOAuthManager } from '../../../agent/mcp/oauth/mcp-oauth-manager.js';
import { canonicalizeConfiguredMcpServer, normalizeConfiguredMcpServers } from '../../../config/mcp-config-normalize.js';
import { getWorkspacePath } from '../../../config/workspace-path-helpers.js';
import { isManagedConnectorServer } from '../../../connectors/materialize.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { AgentPluginStore } from '../../../extensions/agent-plugins/store.js';
import { savePluginAuthBinding } from '../../../extensions/agent-plugins/auth.js';

export function registerMcpRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const resolveServer = (id: string) => {
    const cfg = deps.service.currentConfig;
    const workspaceDir = getWorkspacePath(cfg) || './workspace';
    return loadMergedBundleMcpConfig({ workspaceDir, cfg }).config.mcpServers[id];
  };

  authenticated.get('/api/mcp/servers', async (c) => {
    const cfg = deps.service.currentConfig;
    const workspaceDir = getWorkspacePath(cfg) || './workspace';
    const merged = loadMergedBundleMcpConfig({
      workspaceDir,
      cfg,
    });
    const configured = normalizeConfiguredMcpServers(cfg.mcp?.servers);
    const servers = await Promise.all(Object.entries(merged.config.mcpServers).map(async ([id, server]) => ({
      id,
      plugin: server.xopcPlugin,
      managed: isManagedConnectorServer(server),
      connectorId: isManagedConnectorServer(server) ? server.xopcConnector.connectorId : undefined,
      oauth: await getMcpOAuthManager(server).status(id, server),
    })));
    return c.json({
      ok: true,
      payload: {
        servers: servers.sort((left, right) => left.id.localeCompare(right.id)),
        mergedServerIds: Object.keys(merged.config.mcpServers).sort(),
        configured,
      },
    });
  });

  authenticated.get('/api/mcp/resources', async (c) => {
    const cfg = deps.service.currentConfig;
    const workspaceDir = getWorkspacePath(cfg) || './workspace';
    const query = (c.req.query('q') ?? '').trim().toLocaleLowerCase();
    const serverId = (c.req.query('serverId') ?? '').trim();
    try {
      const resources = await listBundleMcpResourcesForGateway({ workspaceDir, cfg });
      const items = resources.filter((resource) => {
        if (serverId && resource.serverId !== serverId) return false;
        if (!query) return true;
        return [resource.name, resource.title, resource.description, resource.uri, resource.serverId]
          .some((value) => value?.toLocaleLowerCase().includes(query));
      }).slice(0, 20);
      return c.json({ ok: true, payload: { resources: items } });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  authenticated.get('/api/mcp/servers/:id/oauth', async (c) => {
    const id = c.req.param('id');
    const server = resolveServer(id);
    if (!server) return c.json({ ok: false, error: `Unknown MCP server: ${id}` }, 404);
    return c.json({ ok: true, payload: await getMcpOAuthManager(server).status(id, server) });
  });

  authenticated.post('/api/mcp/servers/:id/oauth/callback', deps.strictRateLimitMiddleware, async c => {
    const id = c.req.param('id'); const server = resolveServer(id);
    if (!server) return c.json({ ok: false, error: 'Unknown MCP server' }, 404);
    try {
      const body = await c.req.json();
      if (typeof body.callbackUrl !== 'string' || body.callbackUrl.length > 16384) throw new Error('Expected callbackUrl');
      return c.json({ ok: true, payload: await getMcpOAuthManager(server).submitCallback(id, server, body.callbackUrl) });
    } catch { return c.json({ ok: false, error: 'OAuth callback rejected; verify the URL and active authorization session' }, 400); }
  });

  authenticated.post(
    '/api/mcp/servers/:id/oauth/start',
    deps.strictRateLimitMiddleware,
    async (c) => {
      const id = c.req.param('id');
      const server = resolveServer(id);
      if (!server) return c.json({ ok: false, error: `Unknown MCP server: ${id}` }, 404);
      try {
        const origin = server.xopcPlugin as { id: string; serverName: string } | undefined;
        if (origin) await savePluginAuthBinding(new AgentPluginStore(), origin.id, origin.serverName, { mode: 'oauth' });
        const oauthServer = origin ? resolveServer(id)! : server;
        const payload = await getMcpOAuthManager(oauthServer).start({
          serverId: id,
          rawServer: oauthServer,
          cfg: deps.service.currentConfig,
        });
        return c.json({ ok: true, payload });
      } catch (err) {
        return c.json(
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          400,
        );
      }
    },
  );

  authenticated.delete(
    '/api/mcp/servers/:id/oauth',
    deps.strictRateLimitMiddleware,
    async (c) => {
      const id = c.req.param('id');
      const server = resolveServer(id);
      if (!server) return c.json({ ok: false, error: `Unknown MCP server: ${id}` }, 404);
      try {
        const payload = await getMcpOAuthManager(server).disconnect(id, server);
        return c.json({ ok: true, payload });
      } catch (err) {
        return c.json(
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          400,
        );
      }
    },
  );

  authenticated.get('/api/mcp/servers/:id/tools', async (c) => {
    const id = c.req.param('id');
    const cfg = deps.service.currentConfig;
    const workspaceDir = getWorkspacePath(cfg) || './workspace';
    try {
      const tools = await listBundleMcpServerToolsForGateway({
        workspaceDir,
        cfg,
        serverId: id,
      });
      return c.json({ ok: true, payload: { tools } });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  authenticated.get('/api/mcp/servers/:id/capabilities', async (c) => {
    const id = c.req.param('id');
    const cfg = deps.service.currentConfig;
    const workspaceDir = getWorkspacePath(cfg) || './workspace';
    try {
      const capabilities = await listBundleMcpServerCapabilitiesForGateway({
        workspaceDir,
        cfg,
        serverId: id,
      });
      return c.json({ ok: true, payload: capabilities });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  authenticated.post('/api/mcp/servers/:id/test', async (c) => {
    const id = c.req.param('id');
    const cfg = deps.service.currentConfig;
    const workspaceDir = getWorkspacePath(cfg) || './workspace';
    const body = await c.req.json().catch(() => ({}));
    const inlineServer =
      body && typeof body === 'object' && !Array.isArray(body) && body.server && typeof body.server === 'object'
        ? (body.server as Record<string, unknown>)
        : undefined;
    if (inlineServer && id.startsWith('plugin/')) return c.json({ ok: false, error: 'Plugin servers must use their installed configuration' }, 400);
    const mergedServers = loadMergedBundleMcpConfig({ workspaceDir, cfg }).config.mcpServers;
    const knownServer =
      inlineServer ??
      (mergedServers[id] as Record<string, unknown> | undefined);
    if (!knownServer) {
      return c.json({ ok: false, error: `Unknown MCP server: ${id}` }, 404);
    }
    try {
      const oauth = await getMcpOAuthManager(knownServer).status(id, knownServer);
      if (oauth.configured && knownServer.xopcAutoAuth !== true && oauth.status !== 'connected') {
        return c.json(
          { ok: false, code: 'MCP_AUTHORIZATION_REQUIRED', serverId: id, error: oauth.session?.error ?? 'MCP server authorization is required' },
          409,
        );
      }
      const testCfg: typeof cfg = inlineServer
        ? {
            ...cfg,
            mcp: {
              ...cfg.mcp,
              servers: {
                [id]: canonicalizeConfiguredMcpServer(inlineServer),
              },
            },
          }
        : cfg;
      const capabilities = await listBundleMcpServerCapabilitiesForGateway({
        workspaceDir,
        cfg: testCfg,
        serverId: id,
      });
      if (capabilities.error) return c.json({ ok: false, code: capabilities.error.code, serverId: id, error: capabilities.error.message }, capabilities.error.code === 'MCP_AUTHORIZATION_REQUIRED' ? 409 : 502);
      return c.json({
        ok: true,
        payload: {
          ...capabilities,
          serverId: id,
        },
      });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });
}
