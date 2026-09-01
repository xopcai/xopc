import { normalizeConfiguredMcpServers } from '../../config/mcp-config-normalize.js';
import type { Config } from '../../config/schema.js';
import { inspectExtensionConnectorDependencies } from '../../extensions/connector-dependencies.js';

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

  return {
    config: {
      mcpServers: {
        ...configured,
      },
    },
    diagnostics: inspectExtensionConnectorDependencies({ cfg: params.cfg }),
  };
}
