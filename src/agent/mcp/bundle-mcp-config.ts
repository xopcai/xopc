import { normalizeConfiguredMcpServers } from '../../config/mcp-config-normalize.js';
import type { Config } from '../../config/schema.js';
import { inspectExtensionConnectorDependencies } from '../../extensions/connector-dependencies.js';
import { AgentPluginStore } from '../../extensions/agent-plugins/store.js';
import { materializePluginServers } from '../../extensions/agent-plugins/mcp-adapter.js';

export type BundleMcpServerConfig = Record<string, unknown>;
export type BundleMcpDiagnostic = { extensionId: string; connectorId: string; message: string };
export type BundleMcpConfig = { mcpServers: Record<string, BundleMcpServerConfig> };

export type MergedBundleMcpConfig = {
  config: BundleMcpConfig;
  diagnostics: BundleMcpDiagnostic[];
};

export type BundleMcpServerMapper = (
  server: BundleMcpServerConfig,
  name: string,
) => BundleMcpServerConfig;

function listConfiguredMcpServers(params: {
  cfg?: Config;
  mapConfiguredServer: BundleMcpServerMapper;
}): BundleMcpConfig["mcpServers"] {
  const configuredMcp = normalizeConfiguredMcpServers(params.cfg?.mcp?.servers);
  return Object.fromEntries(
    Object.entries(configuredMcp)
      .filter(([, server]) => {
        const marker = server.xopcConnector;
        return !marker
          || typeof marker !== 'object'
          || Array.isArray(marker)
          || (marker as Record<string, unknown>).enabled !== false;
      })
      .map(([name, server]) => [
        name,
        params.mapConfiguredServer(server as BundleMcpServerConfig, name),
      ]),
  ) satisfies BundleMcpConfig["mcpServers"];
}

export function loadMergedBundleMcpConfig(params: {
  workspaceDir: string;
  cfg?: Config;
  mapConfiguredServer?: BundleMcpServerMapper;
}): MergedBundleMcpConfig {
  const mapConfiguredServer = params.mapConfiguredServer ?? ((server) => server);
  void params.workspaceDir;
  const configured = listConfiguredMcpServers({
    cfg: params.cfg,
    mapConfiguredServer,
  });
  const diagnostics = inspectExtensionConnectorDependencies({ cfg: params.cfg });
  for (const id of Object.keys(configured)) if (id.startsWith('plugin/')) {
    delete configured[id];
    diagnostics.push({ extensionId: '', connectorId: id, message: 'Configured MCP cannot use the reserved plugin/ namespace' });
  }
  const store = new AgentPluginStore();
  const plugins: Record<string, BundleMcpServerConfig> = Object.create(null);
  for (const plugin of store.active()) {
    try {
      const componentDiagnostics = [...plugin.diagnostics];
      for (const [id, server] of Object.entries(materializePluginServers(plugin, store, componentDiagnostics))) {
        plugins[id] = mapConfiguredServer(server, id);
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
