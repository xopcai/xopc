import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

import { initWorkspace } from '../src/cli/utils/init-workspace.js';
import { saveConfig } from '../src/config/loader.js';
import type { Config } from '../src/config/schema.js';
import { ConfigSchema } from '../src/config/schema.js';

import { getDefaultGatewayPort, pickAvailablePort } from './gateway-process.js';

export type ElectronUserPaths = {
  userData: string;
  configPath: string;
  workspacePath: string;
};

export function getElectronUserPaths(): ElectronUserPaths {
  const userData = app.getPath('userData');
  const configPath = join(userData, 'xopc.json');
  const workspacePath = join(userData, 'workspace');
  return { userData, configPath, workspacePath };
}

/**
 * Ensure config exists under userData with a persisted gateway token and workspace path.
 * Returns the gateway auth token for the UI (?token= / localStorage bootstrap).
 */
export async function ensureGatewayConfigForElectron(paths: ElectronUserPaths): Promise<{
  port: number;
  token: string;
}> {
  mkdirSync(paths.userData, { recursive: true });

  const initResult = await initWorkspace({
    configPath: paths.configPath,
    workspacePath: paths.workspacePath,
    gatewayHost: '127.0.0.1',
    gatewayPort: getDefaultGatewayPort(),
    persistWorkspacePath: true,
  });

  const host = '127.0.0.1';
  const preferredPort = initResult.config.gateway?.port ?? getDefaultGatewayPort();
  const resolvedPort = await pickAvailablePort(host, preferredPort, 40);

  let finalConfig: Config = initResult.config;
  if (resolvedPort !== initResult.config.gateway?.port) {
    finalConfig = ConfigSchema.parse({
      ...initResult.config,
      gateway: {
        ...initResult.config.gateway,
        port: resolvedPort,
      },
    });
    await saveConfig(finalConfig, paths.configPath);
  }

  const token =
    finalConfig.gateway?.auth?.mode === 'token' &&
    typeof finalConfig.gateway?.auth?.token === 'string'
      ? finalConfig.gateway.auth.token
      : initResult.token;

  return { port: resolvedPort, token };
}
