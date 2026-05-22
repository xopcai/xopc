import type { Hono } from 'hono';
import { getWorkspacePath } from '../../../config/schema.js';
import { normalizeConfiguredMcpServers } from '../../../config/mcp-config-normalize.js';
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
    const servers = normalizeConfiguredMcpServers(cfg.mcp?.servers);
    if (!servers[id] && !loadMergedBundleMcpConfig({ workspaceDir, cfg }).config.mcpServers[id]) {
      return c.json({ ok: false, error: `Unknown MCP server: ${id}` }, 404);
    }
    try {
      const runtime = await createBundleMcpToolRuntime({
        workspaceDir,
        cfg,
      });
      const tools = runtime.tools.map((t) => t.name);
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
