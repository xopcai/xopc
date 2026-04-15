import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Config } from '../../config/schema.js';
import { ConfigSchema } from '../../config/schema.js';
import { loadConfig, saveConfig } from '../../config/loader.js';
import { assertChannelPluginConfigs } from '../../config/validate-channel-configs.js';

export interface InitWorkspaceOptions {
  configPath: string;
  workspacePath: string;
  /** Gateway host to persist. Defaults to '127.0.0.1'. */
  gatewayHost?: string;
  /** When set with a new config file, overrides schema default port (e.g. Electron). */
  gatewayPort?: number;
  /**
   * When true, writes workspacePath into agents.defaults.workspace.
   * Electron-specific: CLI derives the path from context at runtime.
   */
  persistWorkspacePath?: boolean;
}

export interface InitWorkspaceResult {
  /** Fully-initialised config (matches disk after any write). */
  config: Config;
  /** Gateway auth token (always present after init). */
  token: string;
  configCreated: boolean;
  workspaceCreated: boolean;
}

function serializeConfig(cfg: Config): string {
  const validated = ConfigSchema.parse(cfg);
  assertChannelPluginConfigs(validated);
  return JSON.stringify(validated, null, 2);
}

function tryReadDiskConfig(configPath: string): Config | null {
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const cfg = ConfigSchema.parse(JSON.parse(raw) as unknown);
    assertChannelPluginConfigs(cfg);
    return cfg;
  } catch {
    return null;
  }
}

/**
 * Single idempotent workspace + config initialisation for CLI, gateway, onboard, and Electron.
 * Skips saveConfig (and backup rotation) when the persisted JSON would be unchanged.
 */
export async function initWorkspace(options: InitWorkspaceOptions): Promise<InitWorkspaceResult> {
  const gatewayHost = options.gatewayHost ?? '127.0.0.1';
  const gatewayPortDefaulted = options.gatewayPort ?? 18790;
  const persistWorkspacePath = options.persistWorkspacePath ?? false;
  const { configPath, workspacePath } = options;

  mkdirSync(dirname(configPath), { recursive: true });

  const configExisted = existsSync(configPath);
  const workspaceExisted = existsSync(workspacePath);

  let config: Config;
  if (configExisted) {
    config = loadConfig(configPath);
  } else {
    config = ConfigSchema.parse(undefined);
    assertChannelPluginConfigs(config);
  }

  mkdirSync(workspacePath, { recursive: true });
  mkdirSync(join(workspacePath, 'memory'), { recursive: true });

  const configCreated = !configExisted;
  const workspaceCreated = !workspaceExisted;

  const hadToken =
    config.gateway?.auth?.mode === 'token' &&
    typeof config.gateway?.auth?.token === 'string' &&
    config.gateway.auth.token.length > 0;

  const token = hadToken ? (config.gateway!.auth!.token as string) : randomBytes(24).toString('hex');

  const port = configExisted
    ? (config.gateway?.port ?? gatewayPortDefaulted)
    : options.gatewayPort !== undefined
      ? gatewayPortDefaulted
      : (config.gateway?.port ?? 18790);

  const host = config.gateway?.host ?? gatewayHost;

  const agentsDefaults = {
    ...config.agents.defaults,
    ...(persistWorkspacePath ? { workspace: workspacePath } : {}),
  };

  const nextConfig: Config = {
    ...config,
    agents: {
      ...config.agents,
      defaults: agentsDefaults,
    },
    gateway: {
      ...config.gateway,
      host,
      port,
      auth: {
        ...config.gateway?.auth,
        mode: 'token' as const,
        token,
      },
    },
  };

  const nextFinal = ConfigSchema.parse(nextConfig);
  assertChannelPluginConfigs(nextFinal);

  let needsWrite = configCreated;
  if (!needsWrite) {
    const disk = tryReadDiskConfig(configPath);
    if (!disk) {
      needsWrite = true;
    } else {
      needsWrite = serializeConfig(disk) !== serializeConfig(nextFinal);
    }
  }

  if (needsWrite) {
    await saveConfig(nextFinal, configPath);
  }

  return {
    config: nextFinal,
    token,
    configCreated,
    workspaceCreated,
  };
}
