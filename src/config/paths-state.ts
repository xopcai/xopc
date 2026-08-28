import { homedir } from 'node:os';
import { join } from 'node:path';

export const ENV_VARS = {
  STATE_DIR: 'XOPC_STATE_DIR',
  PROFILE: 'XOPC_PROFILE',
  HOME: 'XOPC_HOME',
  CONFIG_PATH: 'XOPC_CONFIG_PATH',
  CREDENTIALS_DIR: 'XOPC_CREDENTIALS_DIR',
  LOG_LEVEL: 'XOPC_LOG_LEVEL',
  LOG_DIR: 'XOPC_LOG_DIR',
  LOG_CONSOLE: 'XOPC_LOG_CONSOLE',
  LOG_FILE: 'XOPC_LOG_FILE',
  LOG_RETENTION_DAYS: 'XOPC_LOG_RETENTION_DAYS',
  PRETTY_LOGS: 'XOPC_PRETTY_LOGS',
} as const;

export function resolveHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env[ENV_VARS.HOME] || homedir();
}

export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env[ENV_VARS.STATE_DIR]) {
    return env[ENV_VARS.STATE_DIR]!;
  }

  const home = resolveHomeDir(env);
  return join(home, '.xopc');
}

/** Persisted npm update check throttle / notification state (`~/.xopc/update-check.json`). */
export function resolveUpdateCheckStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveStateDir(env), 'update-check.json');
}

/** Cross-process lock for one-click / CLI / auto npm updates (`~/.xopc/update.lock`). */
export function resolveUpdateLockPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveStateDir(env), 'update.lock');
}

/** Primary SQLite state database (`~/.xopc/xopc.db`). */
export const XOPC_DB_FILENAME = 'xopc.db';

export function resolveXopcDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveStateDir(env), XOPC_DB_FILENAME);
}

/** Durable last-known-good XOPC Cloud model catalog. */
export function resolveXopcCloudCatalogCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveStateDir(env), 'cache', 'model-catalog', 'xopc-cloud-v1.json');
}
