import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Config } from '../../config/schema.js';
import { ConfigSchema } from '../../config/schema.js';
import { loadConfig, saveConfig } from '../../config/loader.js';

export interface InitWorkspaceCoreOptions {
  configPath: string;
  workspacePath: string;
  /** When set with a new config file, overrides schema default port (e.g. Electron). */
  gatewayPort?: number;
  /**
   * When true, sets `agents.defaults.workspace` to `dirname(workspacePath)` (parent of the
   * Markdown root being initialised, e.g. `…/workspace` when `workspacePath` is `…/workspace/main`).
   */
  persistWorkspacePath?: boolean;
  /** Optional channel plugin validator (CLI/gateway only; Electron omits). */
  assertChannelPlugins?: (cfg: Config) => void | Promise<void>;
}

export interface InitWorkspaceResult {
  /** Fully-initialised config (matches disk after any write). */
  config: Config;
  /** Gateway auth token (always present after init). */
  token: string;
  configCreated: boolean;
  workspaceCreated: boolean;
}

async function assertChannelPluginsIfNeeded(
  cfg: Config,
  assert?: InitWorkspaceCoreOptions['assertChannelPlugins'],
): Promise<void> {
  if (assert) await assert(cfg);
}

async function serializeConfig(
  cfg: Config,
  assertChannelPlugins?: InitWorkspaceCoreOptions['assertChannelPlugins'],
): Promise<string> {
  const validated = ConfigSchema.parse(cfg);
  await assertChannelPluginsIfNeeded(validated, assertChannelPlugins);
  return JSON.stringify(validated, null, 2);
}

async function tryReadDiskConfig(
  configPath: string,
  assertChannelPlugins?: InitWorkspaceCoreOptions['assertChannelPlugins'],
): Promise<Config | null> {
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const cfg = ConfigSchema.parse(JSON.parse(raw) as unknown);
    await assertChannelPluginsIfNeeded(cfg, assertChannelPlugins);
    return cfg;
  } catch {
    return null;
  }
}

/**
 * Workspace + config initialisation without importing bundled channel plugins.
 * Used by Electron main; CLI/gateway should call {@link initWorkspace} instead.
 */
export async function initWorkspaceCore(options: InitWorkspaceCoreOptions): Promise<InitWorkspaceResult> {
  const gatewayPortDefaulted = options.gatewayPort ?? 18790;
  const persistWorkspacePath = options.persistWorkspacePath ?? false;
  const { configPath, workspacePath, assertChannelPlugins } = options;
  const persistedDefaultsWorkspace = persistWorkspacePath ? dirname(workspacePath) : undefined;

  mkdirSync(dirname(configPath), { recursive: true });

  const configExisted = existsSync(configPath);
  const workspaceExisted = existsSync(workspacePath);

  let config: Config;
  if (configExisted) {
    config = loadConfig(configPath);
  } else {
    config = ConfigSchema.parse(undefined);
    await assertChannelPluginsIfNeeded(config, assertChannelPlugins);
  }

  mkdirSync(workspacePath, { recursive: true });

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

  const agentsDefaults = {
    ...config.agents.defaults,
    ...(persistedDefaultsWorkspace !== undefined ? { workspace: persistedDefaultsWorkspace } : {}),
  };

  const nextConfig: Config = {
    ...config,
    agents: {
      ...config.agents,
      defaults: agentsDefaults,
    },
    gateway: {
      ...config.gateway,
      port,
      auth: {
        ...config.gateway?.auth,
        mode: 'token' as const,
        token,
      },
    },
  };

  const nextFinal = ConfigSchema.parse(nextConfig);
  await assertChannelPluginsIfNeeded(nextFinal, assertChannelPlugins);

  let needsWrite = configCreated;
  if (!needsWrite) {
    const disk = await tryReadDiskConfig(configPath, assertChannelPlugins);
    if (!disk) {
      needsWrite = true;
    } else {
      needsWrite =
        (await serializeConfig(disk, assertChannelPlugins)) !==
        (await serializeConfig(nextFinal, assertChannelPlugins));
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
