import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync } from 'fs';

import type { Config } from './schema.js';
import {
  resolveAgentDir as resolveAgentDirScoped,
  resolveAgentHomeDir as resolveAgentHomeScoped,
  resolveAgentProfileDir as resolveAgentProfileDirScoped,
  resolveAgentProfileMarkdownPath as resolveAgentProfileMarkdownPathScoped,
  resolveAgentWorkspaceDir,
} from '../agent/agent-scope.js';
import { ENV_VARS, resolveStateDir } from './paths-state.js';

export { ENV_VARS, resolveHomeDir, resolveStateDir, resolveXopcDatabasePath, XOPC_DB_FILENAME } from './paths-state.js';
export { resolveDefaultAgentWorkspaceDir } from './workspace-defaults.js';
export {
  resolveAgentWorkspaceDir,
  resolveAgentDir as resolveAgentDirFromConfig,
  resolveAgentHomeDir as resolveAgentHomeDirFromConfig,
} from '../agent/agent-scope.js';

// ============================================
// File Names
// ============================================
export const FILENAMES = {
  CONFIG: 'xopc.json',
  MODELS_JSON: 'models.json',
  AGENT_JSON: 'agent.json',
  /** Primary SQLite state database (`~/.xopc/xopc.db`). */
  XOPC_DB: 'xopc.db',
  EXTENSIONS_LOCK: 'extensions-lock.json',
  CREDENTIALS_PROFILES: 'auth-profiles.json',
  CRON_JOBS: 'jobs.json',
  WORKSPACE_STATE: 'workspace.json',
  SKILLS_CACHE: 'skills-cache.json',
  /** Hub / CLI install provenance for ~/.xopc/skills/<id>. */
  SKILLS_LOCK: 'skills-lock.json',
  PID: 'pid',
  STATUS: 'status.json',
  SOCKET: 'agent.sock',
} as const;

// ============================================
// Workspace Files
// ============================================
export const WORKSPACE_FILES = {
  SOUL: 'SOUL.md',
  IDENTITY: 'IDENTITY.md',
  USER: 'USER.md',
  AGENTS: 'AGENTS.md',
  TOOLS: 'TOOLS.md',
  HEARTBEAT: 'HEARTBEAT.md',
  MEMORY: 'MEMORY.md',
  BOOTSTRAP: 'BOOTSTRAP.md',
} as const;

// ============================================
// Path Resolution Functions
// ============================================

/**
 * Resolve the main config file path
 */
export function resolveConfigPath(): string {
  return process.env[ENV_VARS.CONFIG_PATH] ?? join(resolveStateDir(), FILENAMES.CONFIG);
}

/**
 * Resolve the credentials directory
 */
export function resolveCredentialsDir(): string {
  return process.env[ENV_VARS.CREDENTIALS_DIR] ?? join(resolveStateDir(), 'credentials');
}

/**
 * Resolve the global auth-profiles.json path
 */
export function resolveAuthProfilesPath(): string {
  return join(resolveCredentialsDir(), FILENAMES.CREDENTIALS_PROFILES);
}

/**
 * Resolve OAuth token file path for a provider
 */
export function resolveOAuthPath(provider: string): string {
  return join(resolveCredentialsDir(), 'oauth', `${provider}.json`);
}

/**
 * Internal agent state dir: `stateDir/agents/<id>/agent/`
 * (credentials, inbox IPC, pid, agent.json — not the Markdown workspace).
 */
export function resolveAgentDir(config: Config, agentId: string): string {
  return resolveAgentDirScoped(config, agentId);
}

/**
 * Per-agent home: `stateDir/agents/<id>/` (sessions + `agent/`).
 */
export function resolveAgentHomeDir(config: Config, agentId: string): string {
  return resolveAgentHomeScoped(config, agentId);
}

/** Agent profile Markdown root: `stateDir/agents/<id>/profile/`. */
export function resolveAgentProfileDir(config: Config, agentId: string): string {
  return resolveAgentProfileDirScoped(config, agentId);
}

/** Single file under {@link resolveAgentProfileDir} (basename only). */
export function resolveAgentProfileMarkdownPath(config: Config, agentId: string, filename: string): string {
  return resolveAgentProfileMarkdownPathScoped(config, agentId, filename);
}

/**
 * Resolve a profile system Markdown path (SOUL.md, …) under the agent `profile/` directory.
 */
export function resolveWorkspaceFile(config: Config, filename: string, agentId: string): string {
  return join(resolveAgentProfileDirScoped(config, agentId), filename);
}

/**
 * OpenClaw-aligned: per-agent auth-profiles.json directly under agent dir (no credentials subdirectory).
 */
export function resolveAgentAuthProfilesPath(config: Config, agentId: string): string {
  return join(resolveAgentDir(config, agentId), FILENAMES.CREDENTIALS_PROFILES);
}

/**
 * Resolve the inbox directory for an agent
 */
export function resolveInboxDir(config: Config, agentId: string): string {
  return join(resolveAgentDir(config, agentId), 'inbox');
}

/**
 * Resolve the pending inbox directory
 */
export function resolveInboxPendingDir(config: Config, agentId: string): string {
  return join(resolveInboxDir(config, agentId), 'pending');
}

/**
 * Resolve the processed inbox directory
 */
export function resolveInboxProcessedDir(config: Config, agentId: string): string {
  return join(resolveInboxDir(config, agentId), 'processed');
}

/**
 * Resolve a specific inbox message path
 */
export function resolveInboxMessagePath(
  config: Config,
  messageId: string,
  pending: boolean,
  agentId: string,
): string {
  const dir = pending ? resolveInboxPendingDir(config, agentId) : resolveInboxProcessedDir(config, agentId);
  return join(dir, `${messageId}.json`);
}

/**
 * Resolve the pid file path
 */
export function resolvePidPath(config: Config, agentId: string): string {
  return join(resolveAgentDir(config, agentId), FILENAMES.PID);
}

/**
 * Resolve the status.json path
 */
export function resolveStatusPath(config: Config, agentId: string): string {
  return join(resolveAgentDir(config, agentId), FILENAMES.STATUS);
}

/**
 * Resolve the Unix socket path
 */
export function resolveSocketPath(config: Config, agentId: string): string {
  return join(resolveAgentDir(config, agentId), FILENAMES.SOCKET);
}

/**
 * Resolve the extensions directory (global)
 */
export function resolveExtensionsDir(): string {
  return join(resolveStateDir(), 'extensions');
}

/**
 * Resolve the extensions lockfile path
 */
export function resolveExtensionsLockPath(): string {
  return join(resolveExtensionsDir(), FILENAMES.EXTENSIONS_LOCK);
}

/**
 * Per-agent extensions directory (`…/agents/<id>/agent/extensions/`) — used for discovery of
 * legacy or manually placed copies. CLI, web store, and `extensions dev` symlink installs use
 * {@link resolveExtensionsDir} (`~/.xopc/extensions`) only.
 */
export function resolveWorkspaceExtensionsDir(config: Config, agentId: string): string {
  return join(resolveAgentDir(config, agentId), 'extensions');
}

/**
 * Resolve the skills directory (global)
 */
export function resolveSkillsDir(): string {
  return join(resolveStateDir(), 'skills');
}

/**
 * Resolve a specific skill path
 */
export function resolveSkillPath(skillId: string): string {
  return join(resolveSkillsDir(), skillId, 'SKILL.md');
}

/**
 * Skills hub lock file (~/.xopc/skills-lock.json): install source + content hash per managed skill id.
 */
export function resolveSkillsLockPath(): string {
  return join(resolveStateDir(), FILENAMES.SKILLS_LOCK);
}

/**
 * Resolve the cron directory
 */
export function resolveCronDir(): string {
  return join(resolveStateDir(), 'cron');
}

/**
 * Resolve the cron jobs file path
 */
export function resolveCronJobsPath(): string {
  return join(resolveCronDir(), FILENAMES.CRON_JOBS);
}

/**
 * Resolve the logs directory
 */
export function resolveLogsDir(): string {
  return process.env[ENV_VARS.LOG_DIR] ?? join(resolveStateDir(), 'logs');
}

/**
 * Resolve a specific log file path
 */
export function resolveLogPath(date: string): string {
  return join(resolveLogsDir(), `xopc-${date}.log`);
}

/**
 * Resolve the bin directory
 */
export function resolveBinDir(): string {
  return join(resolveStateDir(), 'bin');
}

/**
 * Resolve the xopc CLI path
 */
export function resolveXopcBinPath(): string {
  return join(resolveBinDir(), 'xopc');
}

/**
 * Resolve the tools directory
 */
export function resolveToolsDir(): string {
  return join(resolveStateDir(), 'tools');
}

/**
 * Resolve the Node.js tools directory
 */
export function resolveNodeToolsDir(): string {
  return join(resolveToolsDir(), 'node');
}

/**
 * Resolve the current Node.js bin directory
 */
export function resolveNodeBinDir(): string {
  return join(resolveNodeToolsDir(), 'current', 'bin');
}

/**
 * Resolve the node binary path
 */
export function resolveNodeBinPath(): string {
  return join(resolveNodeBinDir(), 'node');
}

/**
 * Resolve the npm binary path
 */
export function resolveNpmBinPath(): string {
  return join(resolveNodeBinDir(), 'npm');
}

/**
 * Resolve the models.json path
 */
export function resolveModelsJsonPath(): string {
  return join(resolveStateDir(), FILENAMES.MODELS_JSON);
}

/**
 * Resolve the agent metadata file path
 */
export function resolveAgentMetadataPath(config: Config, agentId: string): string {
  return join(resolveAgentDir(config, agentId), FILENAMES.AGENT_JSON);
}

/**
 * OpenClaw-aligned: workspace setup state directory (`<workspace>/.xopc/`).
 */
export function resolveWorkspaceStateDir(config: Config, agentId: string): string {
  return join(resolveAgentWorkspaceDir(config, agentId), '.xopc');
}

/**
 * OpenClaw-aligned: workspace setup state file (`<workspace>/.xopc/workspace.json`).
 */
export function resolveWorkspaceStatePath(config: Config, agentId: string): string {
  return join(resolveWorkspaceStateDir(config, agentId), FILENAMES.WORKSPACE_STATE);
}

/**
 * Resolve the skills cache file path (internal agent state, under agent dir).
 */
export function resolveSkillsCachePath(config: Config, agentId: string): string {
  return join(resolveAgentDir(config, agentId), 'state', FILENAMES.SKILLS_CACHE);
}

/**
 * Resolve the memory directory
 */
export function resolveMemoryDir(config: Config, agentId: string): string {
  return join(resolveAgentWorkspaceDir(config, agentId), 'memory');
}

/**
 * Resolve a specific memory file path
 */
export function resolveMemoryPath(config: Config, date: string, agentId: string): string {
  return join(resolveMemoryDir(config, agentId), `${date}.md`);
}

/**
 * Resolve the bundled extensions directory (shipped with xopc).
 *
 * Layout-dependent candidates (first existing wins):
 * - `dist/src/config` → `dist/extensions` (npm / gateway)
 * - `src/config` → `extensions/` (dev, tsx)
 * - `out/server` → `dist/extensions` (Electron esbuild bundle)
 */
export function resolveBundledExtensionsDir(): string | null {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const srcDir = dirname(currentFile);
    const candidates = [
      join(srcDir, '..', '..', 'extensions'),
      join(srcDir, '..', '..', 'dist', 'extensions'),
      join(srcDir, '..', '..', '..', 'extensions'),
    ];
    for (const dir of candidates) {
      if (existsSync(dir)) {
        return dir;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the bundled skills directory (shipped with xopc)
 */
export function resolveBundledSkillsDir(): string | null {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const srcDir = dirname(currentFile);
    
    // Production (npm): dist/config/paths.js -> ../../ -> package root -> skills
    const packageRoot = join(srcDir, '..', '..');
    const skillsDir = join(packageRoot, 'skills');
    if (existsSync(skillsDir)) {
      return skillsDir;
    }
    
    // Development (source): src/config/paths.js -> ../../../ -> package root -> skills
    const devPackageRoot = join(srcDir, '..', '..', '..');
    const devSkillsDir = join(devPackageRoot, 'skills');
    if (existsSync(devSkillsDir)) {
      return devSkillsDir;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Path to extension-sdk entry (for jiti / extension loader aliases).
 */
export function resolveExtensionSdkPath(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const srcDir = dirname(currentFile);
    const adjacent = join(srcDir, '..', 'extensions', 'sdk', 'index.ts');
    if (existsSync(adjacent)) {
      return adjacent;
    }
    const fromPackageRoot = join(srcDir, '..', '..', 'src', 'extensions', 'sdk', 'index.ts');
    if (existsSync(fromPackageRoot)) {
      return fromPackageRoot;
    }
    const cwd = join(process.cwd(), 'src', 'extensions', 'sdk', 'index.ts');
    if (existsSync(cwd)) {
      return cwd;
    }
    return adjacent;
  } catch {
    return join(process.cwd(), 'src', 'extensions', 'sdk', 'index.ts');
  }
}

// Re-export existsSync for bundled paths
export { existsSync };
