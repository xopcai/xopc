import type { Hono } from 'hono';
import { getWorkspacePath } from '../../../config/schema.js';
import { normalizeConfiguredMcpServers, canonicalizeConfiguredMcpServer } from '../../../config/mcp-config-normalize.js';
import { loadMergedBundleMcpConfig } from '../../../agent/mcp/bundle-mcp-config.js';
import { createBundleMcpToolRuntime } from '../../../agent/mcp/bundle-mcp-materialize.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerMcpRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/mcp/servers', (c) => {
    const cfg = deps.service.currentConfig;
    const workspaceDir = getWorkspacePath(cfg) || './workspace';
    const merged = loadMergedBundleMcpConfig({
      workspaceDir,
      cfg,
    });
    return c.json({
      ok: true,
      payload: {
        servers: Object.keys(merged.config.mcpServers).sort(),
        configured: normalizeConfiguredMcpServers(cfg.mcp?.servers),
      },
    });
  });

  authenticated.get('/api/mcp/servers/:id/tools', async (c) => {
    const id = c.req.param('id');
    const cfg = deps.service.currentConfig;
    const workspaceDir = getWorkspacePath(cfg) || './workspace';
    try {
      const runtime = await createBundleMcpToolRuntime({
        workspaceDir,
        cfg,
      });
      const tools = runtime.tools
        .filter((t) => t.name.startsWith(`${id}__`))
        .map((t) => ({ name: t.name, description: t.description }));
      await runtime.dispose();
      return c.json({ ok: true, payload: { tools } });
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
    const servers = normalizeConfiguredMcpServers(cfg.mcp?.servers);
    const mergedServers = loadMergedBundleMcpConfig({ workspaceDir, cfg }).config.mcpServers;
    const knownServer =
      inlineServer ??
      (servers[id] as Record<string, unknown> | undefined) ??
      (mergedServers[id] as Record<string, unknown> | undefined);
    if (!knownServer) {
      return c.json({ ok: false, error: `Unknown MCP server: ${id}` }, 404);
    }
    try {
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
      const runtime = await createBundleMcpToolRuntime({
        workspaceDir,
        cfg: testCfg,
      });
      const prefix = `${id}__`;
      const tools = runtime.tools
        .filter((t) => t.name.startsWith(prefix))
        .map((t) => t.name);
      await runtime.dispose();
      return c.json({ ok: true, payload: { serverId: id, toolCount: tools.length, tools } });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  authenticated.post('/api/mcp/approvals/respond', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ ok: true, payload: { acknowledged: true, body } });
  });
}
