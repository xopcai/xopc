import type { Config } from "../../config/schema.js";
import type { BundleMcpDiagnostic, BundleMcpServerConfig } from "../../extensions/bundle-mcp.js";
import { loadMergedBundleMcpConfig } from "./bundle-mcp-config.js";

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
