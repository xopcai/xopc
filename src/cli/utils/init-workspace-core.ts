import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Config } from '../../config/schema.js';
import { ConfigSchema } from '../../config/schema.js';
import { assertConfigRewriteSafeForRunningGateway, saveConfig } from '../../config/loader.js';
import { ensureStarterAgentsInitialized } from '../../agent/starter-agents.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { AgentCatalogService } from '../../agent-catalog/service.js';
import { bootstrapApplicationStateSync } from '../../bootstrap/application-state.js';

export interface InitWorkspaceCoreOptions {
  configPath: string;
  workspacePath: string;
  /** When set with a new config file, overrides schema default port (e.g. Electron). */
  gatewayPort?: number;
  /** When true, sets the default agent workspace to `workspacePath`. */
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

async function readDiskConfig(
  configPath: string,
  assertChannelPlugins?: InitWorkspaceCoreOptions['assertChannelPlugins'],
): Promise<Config> {
  const raw = readFileSync(configPath, 'utf-8');
  const cfg = ConfigSchema.parse(JSON.parse(raw) as unknown);
  await assertChannelPluginsIfNeeded(cfg, assertChannelPlugins);
  return cfg;
}

/**
 * Workspace + config initialisation without importing bundled channel plugins.
 * Used by Electron main; CLI/gateway should call {@link initWorkspace} instead.
 */
export async function initWorkspaceCore(options: InitWorkspaceCoreOptions): Promise<InitWorkspaceResult> {
  const gatewayPortDefaulted = options.gatewayPort ?? 18790;
  const persistWorkspacePath = options.persistWorkspacePath ?? false;
  const { configPath, workspacePath, assertChannelPlugins } = options;
  const persistedWorkspaceRoot = persistWorkspacePath ? workspacePath : undefined;

  mkdirSync(dirname(configPath), { recursive: true });

  const configExisted = existsSync(configPath);
  bootstrapApplicationStateSync(configPath);
  const workspaceExisted = existsSync(workspacePath);

  let config: Config;
  if (configExisted) {
    config = await readDiskConfig(configPath, assertChannelPlugins);
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

  if (persistedWorkspaceRoot !== undefined) {
    const repository = new AgentCatalogRepository();
    const defaultAgentId = repository.getSettings().defaultAgentId;
    const agent = repository.get(defaultAgentId);
    if (agent && agent.workspace !== persistedWorkspaceRoot) {
      await new AgentCatalogService(repository).update(defaultAgentId, { workspace: persistedWorkspaceRoot });
    }
  }

  const nextConfig: Config = {
    ...config,
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

  ensureStarterAgentsInitialized();
  const nextFinal = ConfigSchema.parse(nextConfig);
  await assertChannelPluginsIfNeeded(nextFinal, assertChannelPlugins);

  let needsWrite = configCreated;
  if (!needsWrite) {
    const disk = await readDiskConfig(configPath, assertChannelPlugins);
    needsWrite =
      (await serializeConfig(disk, assertChannelPlugins)) !==
      (await serializeConfig(nextFinal, assertChannelPlugins));
  }

  if (needsWrite) {
    if (assertChannelPlugins) {
      await saveConfig(nextFinal, configPath);
    } else {
      assertConfigRewriteSafeForRunningGateway(configPath);
      writeFileSync(configPath, `${JSON.stringify(nextFinal, null, 2)}\n`, 'utf8');
    }
  }

  return {
    config: nextFinal,
    token,
    configCreated,
    workspaceCreated,
  };
}
