import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export const XOPCBOT_DIR = '.xopcbot';
export const DEFAULT_BASE_DIR = join(homedir(), XOPCBOT_DIR);

export const DEFAULT_PATHS = {
  config: join(DEFAULT_BASE_DIR, 'config.json'),
  workspace: join(DEFAULT_BASE_DIR, 'workspace'),
  sessions: join(DEFAULT_BASE_DIR, 'sessions'),
  plugins: join(DEFAULT_BASE_DIR, 'workspace', '.plugins'),
  globalPlugins: join(DEFAULT_BASE_DIR, 'plugins'),
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

/**
 * Get global plugins directory (~/.xopcbot/plugins/)
 * For plugins shared across all workspaces
 */
export function getGlobalPluginsDir(): string {
  return DEFAULT_PATHS.globalPlugins;
}

/**
 * Get workspace plugins directory (workspace/.plugins/)
 */
export function getWorkspacePluginsDir(workspaceDir?: string): string {
  const ws = workspaceDir || getDefaultWorkspacePath();
  return join(ws, '.plugins');
}

/**
 * Get bundled plugins directory (shipped with xopcbot)
 */
export function getBundledPluginsDir(): string | null {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const srcDir = dirname(currentFile);
    const bundledDir = join(srcDir, '..', '..', 'plugins');
    return bundledDir;
  } catch {
    return null;
  }
}

/**
 * Get plugin SDK path for jiti alias
 */
export function resolvePluginSdkPath(): string | null {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const srcDir = dirname(currentFile);
    return join(srcDir, '..', 'plugin-sdk', 'index.ts');
  } catch {
    return null;
  }
}
