import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

import { initWorkspaceCore } from '../src/cli/utils/init-workspace-core.js';
import {
  resolveGatewayBindMode,
  resolveGatewayEffectiveHost,
} from '../src/config/gateway-bind.js';
import type { GatewayBindMode } from '../src/config/schema.js';
import { ConfigSchema } from '../src/config/schema.js';
import { ensureGatewayCorsOriginsForNetworkBind } from '../src/gateway/ensure-network-cors.js';

import { getDefaultGatewayPort, pickAvailablePort } from './gateway-process.js';

export type ElectronUserPaths = {
  userData: string;
  configPath: string;
  workspacePath: string;
};

export function getElectronUserPaths(): ElectronUserPaths {
  const userData = app.getPath('userData');
  const configPath = join(userData, 'xopc.json');
  const workspacePath = join(userData, 'workspace', 'main');
  return { userData, configPath, workspacePath };
}

/**
 * Ensure config exists under userData with a persisted gateway token and workspace path.
 * Returns the gateway auth token for the UI (?token= / localStorage initial cache).
 */
export async function ensureGatewayConfigForElectron(paths: ElectronUserPaths): Promise<{
  port: number;
  token: string;
  bind: GatewayBindMode;
}> {
  mkdirSync(paths.userData, { recursive: true });

  const initResult = await initWorkspaceCore({
    configPath: paths.configPath,
    workspacePath: paths.workspacePath,
    gatewayPort: getDefaultGatewayPort(),
    persistWorkspacePath: true,
  });

  const preferredPort = initResult.config.gateway?.port ?? getDefaultGatewayPort();
  const listenHost = resolveGatewayEffectiveHost(initResult.config);
  const bindHost = listenHost === '::' ? '::' : listenHost;
  const resolvedPort = await pickAvailablePort(bindHost, preferredPort, 40);

  let finalConfig = ConfigSchema.parse({
    ...initResult.config,
    gateway: {
      ...initResult.config.gateway,
      port: resolvedPort,
    },
  });
  finalConfig = ensureGatewayCorsOriginsForNetworkBind(finalConfig, resolvedPort);

  if (JSON.stringify(finalConfig) !== JSON.stringify(initResult.config)) {
    writeFileSync(paths.configPath, `${JSON.stringify(finalConfig, null, 2)}\n`, 'utf8');
  }

  const bind = resolveGatewayBindMode(finalConfig);

  const token =
    finalConfig.gateway?.auth?.mode === 'token' &&
    typeof finalConfig.gateway?.auth?.token === 'string'
      ? finalConfig.gateway.auth.token
      : initResult.token;

  return { port: resolvedPort, token, bind };
}
