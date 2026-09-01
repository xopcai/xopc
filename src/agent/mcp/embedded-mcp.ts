import type { Config } from "../../config/schema.js";
import { loadMergedBundleMcpConfig, type BundleMcpDiagnostic, type BundleMcpServerConfig } from "./bundle-mcp-config.js";

export type EmbeddedMcpConfig = {
  mcpServers: Record<string, BundleMcpServerConfig>;
  diagnostics: BundleMcpDiagnostic[];
};

export function loadEmbeddedMcpConfig(params: {
  workspaceDir: string;
  cfg?: Config;
}): EmbeddedMcpConfig {
  const bundleMcp = loadMergedBundleMcpConfig({
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
  });

  return {
    mcpServers: bundleMcp.config.mcpServers,
    diagnostics: bundleMcp.diagnostics,
  };
}
