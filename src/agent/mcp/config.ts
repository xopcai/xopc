import { normalizeConfiguredMcpServers } from '../../config/mcp-config-normalize.js';
import type { Config } from '../../config/schema.js';
import { inspectExtensionConnectorDependencies } from '../../extensions/connector-dependencies.js';
import { AgentPluginStore } from '../../extensions/agent-plugins/store.js';
import { materializePluginServers } from '../../extensions/agent-plugins/mcp-adapter.js';

export type HostMcpServerConfig = Record<string, unknown>;
export type HostMcpDiagnostic = { extensionId: string; connectorId: string; message: string };
export type HostMcpConfig = { mcpServers: Record<string, HostMcpServerConfig> };

export type MergedMcpConfig = {
  config: HostMcpConfig;
  diagnostics: HostMcpDiagnostic[];
};

export function loadMergedMcpConfig(params: {
  workspaceDir: string;
  cfg?: Config;
}): MergedMcpConfig {
  const configured = Object.fromEntries(Object.entries(normalizeConfiguredMcpServers(params.cfg?.mcp?.servers))
    .filter(([, server]) => (server.xopcConnector as { enabled?: boolean } | undefined)?.enabled !== false));
  const diagnostics = inspectExtensionConnectorDependencies({ cfg: params.cfg });
  const store = new AgentPluginStore();
  const plugins: Record<string, HostMcpServerConfig> = Object.create(null);
  for (const plugin of store.active()) {
    try {
      const componentDiagnostics = [...plugin.diagnostics];
      for (const [id, server] of Object.entries(materializePluginServers(plugin, store, componentDiagnostics))) {
        if (configured[id]) throw new Error(`MCP server ID conflicts with plugin: ${id}`);
        plugins[id] = server;
      }
      diagnostics.push(...componentDiagnostics.map(d => ({ extensionId: plugin.id, connectorId: d.component, message: d.message })));
    } catch (error) {
      diagnostics.push({ extensionId: plugin.id, connectorId: 'mcp', message: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    config: {
      mcpServers: {
        ...configured,
        ...plugins,
      },
    },
    diagnostics,
  };
}
