import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { app } from 'electron';

import { loadConfig, saveConfig } from '../src/config/loader.js';
import type { Config } from '../src/config/schema.js';
import { ConfigSchema } from '../src/config/schema.js';

export type ElectronUserPaths = {
  userData: string;
  configPath: string;
  workspacePath: string;
};

export function getElectronUserPaths(): ElectronUserPaths {
  const userData = app.getPath('userData');
  const configPath = join(userData, 'xopcbot.json');
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
  mkdirSync(paths.workspacePath, { recursive: true });

  const port = 18790;
  let cfg: Config;

  if (existsSync(paths.configPath)) {
    cfg = loadConfig(paths.configPath);
  } else {
    cfg = ConfigSchema.parse(undefined);
  }

  let token = cfg.gateway?.auth?.token;
  if (!token || cfg.gateway?.auth?.mode !== 'token') {
    token = randomBytes(24).toString('hex');
  }

  const next: Config = ConfigSchema.parse({
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents.defaults,
        workspace: paths.workspacePath,
      },
    },
    gateway: {
      ...cfg.gateway,
      host: '127.0.0.1',
      port,
      auth: {
        mode: 'token',
        token,
      },
    },
  });

  await saveConfig(next, paths.configPath);
  return { port, token };
}
