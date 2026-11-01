import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

import { app } from 'electron';

import {
  resolveAgentProfileDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  normalizeAgentId,
  resolveUserPath,
} from '../src/agent/agent-scope.js';
import { initWorkspaceCore } from '../src/cli/utils/init-workspace-core.js';
import { resolveGatewayBindMode, resolveGatewayEffectiveHost } from '../src/config/gateway-bind.js';
import { resolveConfigPath, resolveStateDir } from '../src/config/paths.js';
import type { Config, GatewayBindMode } from '../src/config/schema.js';
import { ConfigSchema } from '../src/config/schema.js';
import { readConfigFileSnapshot } from '../src/config/config-file.js';
import { XOPC_DB_SCHEMA_VERSION, XOPC_DB_MINIMUM_SCHEMA_VERSION } from '../src/storage/sqlite/schema.js';
import { resolveDefaultAgentWorkspaceDir } from '../src/config/workspace-defaults.js';
import { localGatewayOrigin } from './gateway/local-connection.js';
import { DEFAULT_GATEWAY_PORT } from '../src/daemon/constants.js';
import { configurePackagedSqliteAssetRoot } from './packaged-app-path.js';

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

export function resolveElectronFileIpcRoots(_config: Config, paths: ElectronUserPaths): string[] {
  const defaultAgentId = resolveDefaultAgentId();
  return [
    paths.electronUserData,
    resolveAgentWorkspaceDir(defaultAgentId),
    resolveAgentProfileDir(defaultAgentId),
  ];
}

/** An already running compatible Gateway owns its older database and catalog initialization. */
async function reuseOlderGateway(paths: ElectronUserPaths) {
  const path = join(paths.stateDir, 'xopc.db');
  if (!existsSync(path) || !existsSync(paths.configPath)) return;
  let db: DatabaseSync | undefined, version: number;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    version = Number(db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get()?.value);
  } catch { return; } // Delegate empty, unsupported or corrupt databases to the original initializer.
  finally { db?.close(); }
  if (!Number.isSafeInteger(version) || version < XOPC_DB_MINIMUM_SCHEMA_VERSION || version >= XOPC_DB_SCHEMA_VERSION) return;
  const config = readConfigFileSnapshot(paths.configPath).config;
  if (config.gateway?.auth?.mode !== 'token' || !config.gateway.auth.token) return;
  const port = config.gateway.port ?? DEFAULT_GATEWAY_PORT, token = config.gateway.auth.token;
  const bind = resolveGatewayBindMode(config), bindHost = resolveGatewayEffectiveHost(config);
  try {
    const probe = await fetch(`${localGatewayOrigin({ port })}/api/config`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(1500),
    });
    const accepted = probe.ok; await probe.body?.cancel(); if (!accepted) return;
  } catch { return; }
  // The existing startup supervisor still checks protocol compatibility before exposing the main UI.
  const response = await fetch(`${localGatewayOrigin({ port })}/api/agents`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Reused Gateway agent catalog is unavailable');
  if (!response.body) throw new Error('Reused Gateway agent catalog is unavailable');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > 256 * 1024) { await reader.cancel(); throw new Error('Reused Gateway agent catalog is too large'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const value = JSON.parse(Buffer.concat(chunks).toString()); const catalog = value.payload ?? value;
  if (!Array.isArray(catalog.agents) || typeof catalog.defaultId !== 'string') throw new Error('Reused Gateway agent catalog is invalid');
  const id = normalizeAgentId(catalog.defaultId);
  const agent = catalog.agents.find((entry: { id?: unknown }) => entry?.id === id);
  if (!agent || agent.workspace != null && typeof agent.workspace !== 'string') throw new Error('Reused Gateway default agent is invalid');
  const workspace = agent.workspace?.trim() ? resolveUserPath(agent.workspace) : resolveDefaultAgentWorkspaceDir(process.env);
  return { port, token, bind, bindHost: bindHost === '::' ? '::' : bindHost,
    fileIpcRoots: [paths.electronUserData, workspace, resolveAgentProfileDir(id)] };
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
  configurePackagedSqliteAssetRoot();
  const reused = await reuseOlderGateway(paths);
  if (reused) return reused;
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
