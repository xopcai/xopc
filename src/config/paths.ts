import { homedir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ============================================
// Environment Variable Names
// ============================================
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

// ============================================
// File Names
// ============================================
export const FILENAMES = {
  CONFIG: 'xopcbot.json',
  MODELS_JSON: 'models.json',
  AGENT_JSON: 'agent.json',
  SESSIONS_INDEX: 'index.json',
  SUBAGENTS_REGISTRY: 'runs.json',
  EXTENSIONS_LOCK: 'extensions-lock.json',
  CREDENTIALS_PROFILES: 'auth-profiles.json',
  CRON_JOBS: 'jobs.json',
  WORKSPACE_STATE: 'workspace.json',
  SKILLS_CACHE: 'skills-cache.json',
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
  CONTEXT: 'CONTEXT.md',
  SKILLS: 'SKILLS.md',
  BOOTSTRAP: 'BOOTSTRAP.md',
} as const;

// ============================================
// Path Resolution Functions
// ============================================

/**
 * Resolve the home directory (respects XOPCBOT_HOME)
 */
export function resolveHomeDir(): string {
  return process.env[ENV_VARS.HOME] || homedir();
}

/**
 * Resolve the state directory root
 * Priority: XOPCBOT_STATE_DIR > XOPCBOT_PROFILE > ~/.xopcbot
 */
export function resolveStateDir(): string {
  if (process.env[ENV_VARS.STATE_DIR]) {
    return process.env[ENV_VARS.STATE_DIR]!;
  }

  const profile = process.env[ENV_VARS.PROFILE];
  const home = resolveHomeDir();

  if (profile && profile !== 'default') {
    return join(home, `.xopcbot-${profile}`);
  }

  return join(home, '.xopcbot');
}

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
 * Resolve the current agent ID
 */
export function resolveAgentId(): string {
  return process.env[ENV_VARS.AGENT_ID] ?? 'main';
}

/**
 * Resolve an agent's root directory
 */
export function resolveAgentDir(agentId?: string): string {
  const id = agentId ?? resolveAgentId();
  return process.env[ENV_VARS.AGENT_DIR] ?? join(resolveStateDir(), 'agents', id);
}

/**
 * Resolve an agent's workspace directory
 */
export function resolveWorkspaceDir(agentId?: string): string {
  return join(resolveAgentDir(agentId), 'workspace');
}

/**
 * Resolve a specific workspace file path
 */
export function resolveWorkspaceFile(filename: string, agentId?: string): string {
  return join(resolveWorkspaceDir(agentId), filename);
}

/**
 * Resolve the agent's private credentials directory
 */
export function resolveAgentCredentialsDir(agentId?: string): string {
  return join(resolveAgentDir(agentId), 'credentials');
}

/**
 * Resolve agent's private auth-profiles.json path
 */
export function resolveAgentAuthProfilesPath(agentId?: string): string {
  return join(resolveAgentCredentialsDir(agentId), FILENAMES.CREDENTIALS_PROFILES);
}

/**
 * Resolve the sessions directory for an agent
 */
export function resolveSessionsDir(agentId?: string): string {
  return join(resolveAgentDir(agentId), 'sessions');
}

/**
 * Resolve the sessions index file path
 */
export function resolveSessionsIndexPath(agentId?: string): string {
  return join(resolveSessionsDir(agentId), FILENAMES.SESSIONS_INDEX);
}

/**
 * Resolve a specific session file path
 */
export function resolveSessionPath(sessionId: string, agentId?: string): string {
  return join(resolveSessionsDir(agentId), `${sessionId}.jsonl`);
}

/**
 * Resolve the sessions archive directory
 */
export function resolveSessionsArchiveDir(agentId?: string): string {
  return join(resolveSessionsDir(agentId), 'archive');
}

/**
 * Resolve the inbox directory for an agent
 */
export function resolveInboxDir(agentId?: string): string {
  return join(resolveAgentDir(agentId), 'inbox');
}

/**
 * Resolve the pending inbox directory
 */
export function resolveInboxPendingDir(agentId?: string): string {
  return join(resolveInboxDir(agentId), 'pending');
}

/**
 * Resolve the processed inbox directory
 */
export function resolveInboxProcessedDir(agentId?: string): string {
  return join(resolveInboxDir(agentId), 'processed');
}

/**
 * Resolve a specific inbox message path
 */
export function resolveInboxMessagePath(messageId: string, pending: boolean, agentId?: string): string {
  const dir = pending ? resolveInboxPendingDir(agentId) : resolveInboxProcessedDir(agentId);
  return join(dir, `${messageId}.json`);
}

/**
 * Resolve the run directory (volatile runtime state)
 */
export function resolveRunDir(agentId?: string): string {
  return join(resolveAgentDir(agentId), 'run');
}

/**
 * Resolve the pid file path
 */
export function resolvePidPath(agentId?: string): string {
  return join(resolveRunDir(agentId), FILENAMES.PID);
}

/**
 * Resolve the status.json path
 */
export function resolveStatusPath(agentId?: string): string {
  return join(resolveRunDir(agentId), FILENAMES.STATUS);
}

/**
 * Resolve the Unix socket path
 */
export function resolveSocketPath(agentId?: string): string {
  return join(resolveRunDir(agentId), FILENAMES.SOCKET);
}

/**
 * Resolve the subagents registry path (global)
 */
export function resolveSubagentRegistryPath(): string {
  return join(resolveStateDir(), 'subagents', FILENAMES.SUBAGENTS_REGISTRY);
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
 * Resolve the workspace extensions directory
 */
export function resolveWorkspaceExtensionsDir(agentId?: string): string {
  return join(resolveWorkspaceDir(agentId), '.extensions');
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
 * Resolve the cron logs directory
 */
export function resolveCronLogsDir(): string {
  return join(resolveCronDir(), 'logs');
}

/**
 * Resolve a specific cron log file path
 */
export function resolveCronLogPath(date: string): string {
  return join(resolveCronLogsDir(), `${date}.jsonl`);
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
  return join(resolveLogsDir(), `xopcbot-${date}.log`);
}

/**
 * Resolve the bin directory
 */
export function resolveBinDir(): string {
  return join(resolveStateDir(), 'bin');
}

/**
 * Resolve the xopcbot CLI path
 */
export function resolveXopcbotBinPath(): string {
  return join(resolveBinDir(), 'xopcbot');
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
export function resolveAgentMetadataPath(agentId?: string): string {
  return join(resolveAgentDir(agentId), FILENAMES.AGENT_JSON);
}

/**
 * Resolve the workspace state directory (.state/)
 */
export function resolveWorkspaceStateDir(agentId?: string): string {
  return join(resolveWorkspaceDir(agentId), '.state');
}

/**
 * Resolve the workspace state file path
 */
export function resolveWorkspaceStatePath(agentId?: string): string {
  return join(resolveWorkspaceStateDir(agentId), FILENAMES.WORKSPACE_STATE);
}

/**
 * Resolve the skills cache file path
 */
export function resolveSkillsCachePath(agentId?: string): string {
  return join(resolveWorkspaceStateDir(agentId), FILENAMES.SKILLS_CACHE);
}

/**
 * Resolve the memory directory
 */
export function resolveMemoryDir(agentId?: string): string {
  return join(resolveWorkspaceDir(agentId), 'memory');
}

/**
 * Resolve a specific memory file path
 */
export function resolveMemoryPath(date: string, agentId?: string): string {
  return join(resolveMemoryDir(agentId), `${date}.md`);
}

/**
 * Resolve the bundled extensions directory (shipped with xopcbot)
 */
export function resolveBundledExtensionsDir(): string | null {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const srcDir = dirname(currentFile);
    const bundledDir = join(srcDir, '..', '..', 'extensions');
    return bundledDir;
  } catch {
    return null;
  }
}

/**
 * Resolve the bundled skills directory (shipped with xopcbot)
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

// Re-export existsSync for bundled paths
import { existsSync } from 'fs';
export { existsSync };

// ============================================
// Legacy Compatibility (for migration)
// ============================================

/** @deprecated Use resolveStateDir() instead */
export const XOPCBOT_DIR = '.xopcbot';

/** @deprecated Use resolveStateDir() instead */
export const DEFAULT_BASE_DIR = resolveStateDir();

/** @deprecated Use resolveConfigPath() instead */
export const DEFAULT_PATHS = {
  config: resolveConfigPath(),
  modelsJson: resolveModelsJsonPath(),
  workspace: resolveWorkspaceDir(),
  sessions: resolveSessionsDir(),
  extensions: resolveWorkspaceExtensionsDir(),
  globalExtensions: resolveExtensionsDir(),
  memory: resolveMemoryDir(),
  cronJobs: resolveCronJobsPath(),
} as const;

/** @deprecated Use resolveConfigPath() instead */
export function getDefaultConfigPath(): string {
  return process.env.XOPCBOT_CONFIG || resolveConfigPath();
}

/** @deprecated Use resolveModelsJsonPath() instead */
export function getModelsJsonPath(): string {
  return process.env.XOPCBOT_MODELS_JSON || resolveModelsJsonPath();
}

/** @deprecated Use resolveWorkspaceDir() instead */
export function getDefaultWorkspacePath(): string {
  return process.env.XOPCBOT_WORKSPACE || resolveWorkspaceDir();
}

/** @deprecated Use resolveStateDir() instead */
export function getBaseDir(): string {
  return resolveStateDir();
}

/** @deprecated Use resolveExtensionsDir() instead */
export function getGlobalExtensionsDir(): string {
  return resolveExtensionsDir();
}

/** @deprecated Use resolveWorkspaceExtensionsDir() instead */
export function getWorkspaceExtensionsDir(workspaceDir?: string): string {
  if (workspaceDir) {
    return join(workspaceDir, '.extensions');
  }
  return resolveWorkspaceExtensionsDir();
}

/** @deprecated Use resolveBundledExtensionsDir() instead */
export function getBundledExtensionsDir(): string | null {
  return resolveBundledExtensionsDir();
}

/** @deprecated Use resolveBundledSkillsDir() instead */
export function getBundledSkillsDir(): string | null {
  return resolveBundledSkillsDir();
}
