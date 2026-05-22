import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config/schema.js';
import { normalizeConfiguredMcpServers } from '../config/mcp-config-normalize.js';
import {
  resolveBundledExtensionsDir,
  resolveExtensionsDir,
} from '../config/paths.js';
import { isRecord } from '../utils/is-record.js';

export type BundleMcpServerConfig = Record<string, unknown>;

export type BundleMcpConfig = {
  mcpServers: Record<string, BundleMcpServerConfig>;
};

export type BundleMcpDiagnostic = {
  extensionId: string;
  message: string;
};

export type EnabledBundleMcpConfigResult = {
  config: BundleMcpConfig;
  diagnostics: BundleMcpDiagnostic[];
};

function extractMcpServerMap(raw: unknown): Record<string, BundleMcpServerConfig> {
  if (!isRecord(raw)) {
    return {};
  }
  const nested = isRecord(raw.mcpServers)
    ? raw.mcpServers
    : isRecord(raw.servers)
      ? raw.servers
      : raw;
  if (!isRecord(nested)) {
    return {};
  }
  const result: Record<string, BundleMcpServerConfig> = {};
  for (const [serverName, serverRaw] of Object.entries(nested)) {
    if (!isRecord(serverRaw)) {
      continue;
    }
    result[serverName] = { ...serverRaw };
  }
  return result;
}

function readMcpJsonFile(filePath: string): Record<string, BundleMcpServerConfig> {
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    return extractMcpServerMap(raw);
  } catch {
    return {};
  }
}

function isExtensionEnabled(extensionId: string, cfg?: Config): boolean {
  const disabled = (cfg?.extensions?.disabled ?? []) as string[];
  if (disabled.includes(extensionId)) {
    return false;
  }
  const enabled = cfg?.extensions?.enabled as string[] | undefined;
  if (Array.isArray(enabled) && enabled.length > 0) {
    return enabled.includes(extensionId);
  }
  return true;
}

function scanExtensionsRoot(root: string, cfg: Config | undefined, merged: Record<string, BundleMcpServerConfig>, diagnostics: BundleMcpDiagnostic[]): void {
  if (!existsSync(root)) {
    return;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const extensionId = entry.name;
    if (!isExtensionEnabled(extensionId, cfg)) {
      continue;
    }
    const extRoot = join(root, extensionId);
    const servers = readMcpJsonFile(join(extRoot, '.mcp.json'));
    for (const [name, server] of Object.entries(servers)) {
      const key = merged[name] ? `${extensionId}__${name}` : name;
      if (merged[name] && !merged[`${extensionId}__${name}`]) {
        diagnostics.push({
          extensionId,
          message: `MCP server "${name}" renamed to "${key}" due to name collision.`,
        });
      }
      merged[key] = server;
    }
  }
}

export function loadEnabledBundleMcpConfig(params: {
  workspaceDir?: string;
  cfg?: Config;
}): EnabledBundleMcpConfigResult {
  void params.workspaceDir;
  const merged: Record<string, BundleMcpServerConfig> = {};
  const diagnostics: BundleMcpDiagnostic[] = [];

  scanExtensionsRoot(resolveExtensionsDir(), params.cfg, merged, diagnostics);
  const bundled = resolveBundledExtensionsDir();
  if (bundled) {
    scanExtensionsRoot(bundled, params.cfg, merged, diagnostics);
  }

  return {
    config: { mcpServers: merged },
    diagnostics,
  };
}

export function hasAnyMcpServers(cfg?: Config): boolean {
  const user = normalizeConfiguredMcpServers(cfg?.mcp?.servers);
  if (Object.keys(user).length > 0) {
    return true;
  }
  const bundle = loadEnabledBundleMcpConfig({ cfg });
  return Object.keys(bundle.config.mcpServers).length > 0;
}
