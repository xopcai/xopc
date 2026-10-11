import type { Hono } from 'hono';
import { loadMergedMcpConfig } from '../../../agent/mcp/config.js';
import { getWorkspacePath } from '../../../config/workspace-path-helpers.js';
import { isManagedConnectorServer } from '../../../connectors/materialize.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerMcpRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
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
