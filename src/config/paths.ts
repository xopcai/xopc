import { homedir } from 'os';
import { join } from 'path';

export const XOPCBOT_DIR = '.xopcbot';
export const DEFAULT_BASE_DIR = join(homedir(), XOPCBOT_DIR);

export const DEFAULT_PATHS = {
  config: join(DEFAULT_BASE_DIR, 'config.json'),
  workspace: join(DEFAULT_BASE_DIR, 'workspace'),
  sessions: join(DEFAULT_BASE_DIR, 'sessions'),
  plugins: join(DEFAULT_BASE_DIR, 'plugins'),
  memory: join(DEFAULT_BASE_DIR, 'memory'),
  cronJobs: join(DEFAULT_BASE_DIR, 'cron-jobs.json'),
} as const;

export function getDefaultConfigPath(): string {
  return process.env.XOPCBOT_CONFIG || DEFAULT_PATHS.config;
}

export function getDefaultWorkspacePath(): string {
  return process.env.XOPCBOT_WORKSPACE || DEFAULT_PATHS.workspace;
}

export function getBaseDir(): string {
  return DEFAULT_BASE_DIR;
}
