import { normalizeConfiguredMcpServers } from '../../config/mcp-config-normalize.js';
import { isManagedConnectorServer } from '../../connectors/materialize.js';
import type { Config } from '../../config/schema.js';
import {
  type BundleMcpConfig,
  type BundleMcpDiagnostic,
  type BundleMcpServerConfig,
} from '../../extensions/bundle-mcp.js';

export type MergedBundleMcpConfig = {
  config: BundleMcpConfig;
  diagnostics: BundleMcpDiagnostic[];
};

export type BundleMcpServerMapper = (
  server: BundleMcpServerConfig,
  name: string,
) => BundleMcpServerConfig;

function listConnectorManagedMcpServers(params: {
  cfg?: Config;
  mapConfiguredServer: BundleMcpServerMapper;
}): BundleMcpConfig["mcpServers"] {
  const configuredMcp = normalizeConfiguredMcpServers(params.cfg?.mcp?.servers);
  return Object.fromEntries(
    Object.entries(configuredMcp)
      .filter(([, server]) => isManagedConnectorServer(server))
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

  return {
    config: {
      mcpServers: listConnectorManagedMcpServers({
        cfg: params.cfg,
        mapConfiguredServer,
      }),
    },
    diagnostics: [],
  };
}
