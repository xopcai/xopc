import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

import {
  resolveAgentProfileDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from '../src/agent/agent-scope.js';
import { initWorkspaceCore } from '../src/cli/utils/init-workspace-core.js';
import { resolveGatewayBindMode, resolveGatewayEffectiveHost } from '../src/config/gateway-bind.js';
import { resolveConfigPath, resolveStateDir } from '../src/config/paths.js';
import type { Config, GatewayBindMode } from '../src/config/schema.js';
import { ConfigSchema } from '../src/config/schema.js';
import { DEFAULT_GATEWAY_PORT } from '../src/daemon/constants.js';

export type ElectronUserPaths = {
  stateDir: string;
  electronUserData: string;
  configPath: string;
  workspacePath: string;
};

export function getElectronUserPaths(): ElectronUserPaths {
  const stateDir = resolveStateDir();
  const electronUserData = app.getPath('userData');
  const configPath = resolveConfigPath();
  const workspacePath = join(stateDir, 'workspace', 'main');
  return { stateDir, electronUserData, configPath, workspacePath };
}

export function resolveElectronFileIpcRoots(config: Config, paths: ElectronUserPaths): string[] {
  const defaultAgentId = resolveDefaultAgentId(config);
  return [
    paths.electronUserData,
    resolveAgentWorkspaceDir(config, defaultAgentId),
    resolveAgentProfileDir(config, defaultAgentId),
  ];
}

/**
 * Ensure shared xopc config exists with a persisted gateway token and workspace path.
 * Returns the gateway auth token for trusted Electron IPC initialization.
 */
export async function ensureGatewayConfigForElectron(paths: ElectronUserPaths): Promise<{
  port: number;
  token: string;
  bind: GatewayBindMode;
  bindHost: string;
  fileIpcRoots: string[];
}> {
  mkdirSync(paths.stateDir, { recursive: true });

  const initResult = await initWorkspaceCore({
    configPath: paths.configPath,
    workspacePath: paths.workspacePath,
    gatewayPort: DEFAULT_GATEWAY_PORT,
    persistWorkspacePath: true,
  });

  const configuredPort = initResult.config.gateway?.port;
  const resolvedPort = configuredPort ?? DEFAULT_GATEWAY_PORT;

  const finalConfig = ConfigSchema.parse({
    ...initResult.config,
    gateway: {
      ...initResult.config.gateway,
      port: resolvedPort,
    },
  });
  if (JSON.stringify(finalConfig) !== JSON.stringify(initResult.config)) {
    writeFileSync(paths.configPath, `${JSON.stringify(finalConfig, null, 2)}\n`, 'utf8');
  }

  const bind = resolveGatewayBindMode(finalConfig);
  const listenHost = resolveGatewayEffectiveHost(finalConfig);
  const bindHost = listenHost === '::' ? '::' : listenHost;

  const token =
    finalConfig.gateway?.auth?.mode === 'token' &&
    typeof finalConfig.gateway?.auth?.token === 'string'
      ? finalConfig.gateway.auth.token
      : initResult.token;

  return {
    port: resolvedPort,
    token,
    bind,
    bindHost,
    fileIpcRoots: resolveElectronFileIpcRoots(finalConfig, paths),
  };
}
