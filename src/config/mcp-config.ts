import { existsSync } from 'node:fs';
import type { Config } from './schema.js';
import { loadConfig, saveConfig } from './loader.js';
import { resolveConfigPath } from './paths.js';
import {
  canonicalizeConfiguredMcpServer,
  normalizeConfiguredMcpServers,
  type ConfigMcpServers,
} from './mcp-config-normalize.js';
import { isRecord } from '../utils/is-record.js';

export { normalizeConfiguredMcpServers, type ConfigMcpServers } from './mcp-config-normalize.js';

type ConfigMcpReadResult =
  | {
      ok: true;
      path: string;
      config: Config;
      mcpServers: ConfigMcpServers;
    }
  | { ok: false; path: string; error: string };

type ConfigMcpWriteResult =
  | {
      ok: true;
      path: string;
      config: Config;
      mcpServers: ConfigMcpServers;
      removed?: boolean;
    }
  | { ok: false; path: string; error: string };

export function listConfiguredMcpServers(configPath?: string): ConfigMcpReadResult {
  const path = configPath?.trim() || process.env.XOPC_CONFIG_PATH?.trim() || resolveConfigPath();
  if (!existsSync(path)) {
    return { ok: false, path, error: 'Config file not found.' };
  }
  try {
    const config = loadConfig(path);
    return {
      ok: true,
      path,
      config: structuredClone(config),
      mcpServers: normalizeConfiguredMcpServers(config.mcp?.servers),
    };
  } catch (error) {
    return {
      ok: false,
      path,
      error: `Config file is invalid: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function setConfiguredMcpServer(params: {
  name: string;
  server: unknown;
  configPath?: string;
}): Promise<ConfigMcpWriteResult> {
  const name = params.name.trim();
  if (!name) {
    return { ok: false, path: '', error: 'MCP server name is required.' };
  }
  if (!isRecord(params.server)) {
    return { ok: false, path: '', error: 'MCP server config must be a JSON object.' };
  }

  const loaded = listConfiguredMcpServers(params.configPath);
  if (!loaded.ok) {
    return loaded;
  }

  const next = structuredClone(loaded.config);
  const servers = normalizeConfiguredMcpServers(next.mcp?.servers);
  servers[name] = canonicalizeConfiguredMcpServer(params.server);
  next.mcp = { ...next.mcp, servers };

  try {
    await saveConfig(next, loaded.path);
  } catch (error) {
    return {
      ok: false,
      path: loaded.path,
      error: `Failed to save config: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return { ok: true, path: loaded.path, config: next, mcpServers: servers };
}

export async function unsetConfiguredMcpServer(params: {
  name: string;
  configPath?: string;
}): Promise<ConfigMcpWriteResult> {
  const name = params.name.trim();
  if (!name) {
    return { ok: false, path: '', error: 'MCP server name is required.' };
  }

  const loaded = listConfiguredMcpServers(params.configPath);
  if (!loaded.ok) {
    return loaded;
  }
  if (!Object.hasOwn(loaded.mcpServers, name)) {
    return {
      ok: true,
      path: loaded.path,
      config: loaded.config,
      mcpServers: loaded.mcpServers,
      removed: false,
    };
  }

  const next = structuredClone(loaded.config);
  const servers = normalizeConfiguredMcpServers(next.mcp?.servers);
  delete servers[name];
  if (Object.keys(servers).length > 0) {
    next.mcp = { ...next.mcp, servers };
  } else if (next.mcp) {
    delete next.mcp.servers;
    if (Object.keys(next.mcp).length === 0) {
      delete next.mcp;
    }
  }

  try {
    await saveConfig(next, loaded.path);
  } catch (error) {
    return {
      ok: false,
      path: loaded.path,
      error: `Failed to save config: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    ok: true,
    path: loaded.path,
    config: next,
    mcpServers: servers,
    removed: true,
  };
}
