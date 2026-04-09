import { homedir } from 'node:os';
import { join } from 'node:path';

export const ENV_VARS = {
  STATE_DIR: 'XOPCBOT_STATE_DIR',
  PROFILE: 'XOPCBOT_PROFILE',
  HOME: 'XOPCBOT_HOME',
  CONFIG_PATH: 'XOPCBOT_CONFIG_PATH',
  CREDENTIALS_DIR: 'XOPCBOT_CREDENTIALS_DIR',
  AGENT_ID: 'XOPCBOT_AGENT_ID',
  AGENT_DIR: 'XOPCBOT_AGENT_DIR',
  LOG_LEVEL: 'XOPCBOT_LOG_LEVEL',
  LOG_DIR: 'XOPCBOT_LOG_DIR',
  LOG_CONSOLE: 'XOPCBOT_LOG_CONSOLE',
  LOG_FILE: 'XOPCBOT_LOG_FILE',
  LOG_RETENTION_DAYS: 'XOPCBOT_LOG_RETENTION_DAYS',
  PRETTY_LOGS: 'XOPCBOT_PRETTY_LOGS',
} as const;

export function resolveHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env[ENV_VARS.HOME] || homedir();
}

export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env[ENV_VARS.STATE_DIR]) {
    return env[ENV_VARS.STATE_DIR]!;
  }

  const profile = env[ENV_VARS.PROFILE];
  const home = resolveHomeDir(env);

  if (profile && profile !== 'default') {
    return join(home, `.xopcbot-${profile}`);
  }

  return join(home, '.xopcbot');
}

export function resolveAgentId(env: NodeJS.ProcessEnv = process.env): string {
  return env[ENV_VARS.AGENT_ID] ?? 'main';
}
