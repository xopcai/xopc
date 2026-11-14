import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Config } from '../../config/schema.js';
import { ConfigSchema } from '../../config/schema.js';
import { saveConfig } from '../../config/loader.js';
import { readConfigFileSnapshot } from '../../config/config-file.js';
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
  /** GatewayServer initializes application state itself after acquiring the lock. */
  deferApplicationBootstrap?: boolean;
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

async function readDiskConfig(
  configPath: string,
  assertChannelPlugins?: InitWorkspaceCoreOptions['assertChannelPlugins'],
): Promise<Config> {
  const snapshot = readConfigFileSnapshot(configPath);
  const cfg = snapshot.config;
  await assertChannelPluginsIfNeeded(cfg, assertChannelPlugins);
  snapshot.discardRetiredFields();
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
  let applicationBootstrapped = false;
  const bootstrap = () => {
    if (!applicationBootstrapped) bootstrapApplicationStateSync();
    applicationBootstrapped = true;
  };
  if (!options.deferApplicationBootstrap || persistWorkspacePath) bootstrap();
  const workspaceExisted = existsSync(workspacePath);

  let config: Config;
  if (configExisted) {
    config = await readDiskConfig(configPath, async (cfg) => {
      if (assertChannelPlugins && Object.keys(cfg.channels ?? {}).length) bootstrap();
      await assertChannelPluginsIfNeeded(cfg, assertChannelPlugins);
    });
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

  if (hadToken && !configCreated && config.gateway.port === port) {
    return { config, token, configCreated, workspaceCreated };
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

  const nextFinal = ConfigSchema.parse(nextConfig);
  await assertChannelPluginsIfNeeded(nextFinal, assertChannelPlugins);

  const needsWrite = configCreated || JSON.stringify(config) !== JSON.stringify(nextFinal);
  if (needsWrite) {
    if (assertChannelPlugins) {
      await saveConfig(nextFinal, configPath);
    } else {
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
