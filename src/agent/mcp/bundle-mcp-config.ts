import { normalizeConfiguredMcpServers } from '../../config/mcp-config-normalize.js';
import type { Config } from '../../config/schema.js';
import {
  loadEnabledBundleMcpConfig,
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

function listConfiguredMcpServers(params: {
  cfg?: Config;
  mapConfiguredServer: BundleMcpServerMapper;
}): BundleMcpConfig["mcpServers"] {
  const configuredMcp = normalizeConfiguredMcpServers(params.cfg?.mcp?.servers);
  return Object.fromEntries(
    Object.entries(configuredMcp)
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
  const bundled = loadEnabledBundleMcpConfig({
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
  });
  const configured = listConfiguredMcpServers({
    cfg: params.cfg,
    mapConfiguredServer,
  });

  return {
    config: {
      mcpServers: {
        ...bundled.config.mcpServers,
        ...configured,
      },
    },
    diagnostics: bundled.diagnostics,
  };
}
