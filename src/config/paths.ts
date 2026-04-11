import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync } from 'fs';

import type { Config } from './schema.js';
import {
  resolveAgentDir as resolveAgentDirScoped,
  resolveAgentHomeDir as resolveAgentHomeScoped,
  resolveAgentWorkspaceDir,
  resolveSessionsDir as resolveSessionsDirScoped,
} from '../agent/agent-scope.js';
import { ENV_VARS, resolveHomeDir, resolveStateDir } from './paths-state.js';
import { resolveDefaultAgentWorkspaceDir } from './workspace-defaults.js';

export { ENV_VARS, resolveHomeDir, resolveStateDir } from './paths-state.js';
export { resolveDefaultAgentWorkspaceDir } from './workspace-defaults.js';
export {
  resolveAgentWorkspaceDir,
  resolveAgentBootstrapDir,
  resolveAgentDir as resolveAgentDirFromConfig,
  resolveAgentHomeDir as resolveAgentHomeDirFromConfig,
  resolveSessionsDir as resolveSessionsDirFromConfig,
} from '../agent/agent-scope.js';

// ============================================
// File Names
// ============================================
export const FILENAMES = {
  CONFIG: 'xopcbot.json',
  MODELS_JSON: 'models.json',
  AGENT_JSON: 'agent.json',
  SESSIONS_INDEX: 'index.json',
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
 * OpenClaw `agentDir`: internal state under `stateDir/agents/<id>/agent/`
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

/**
 * Resolve a specific workspace file path
 */
export function resolveWorkspaceFile(config: Config, filename: string, agentId: string): string {
  return join(resolveAgentWorkspaceDir(config, agentId), filename);
}

/**
 * Resolve the agent's private credentials directory
 */
export function resolveAgentCredentialsDir(config: Config, agentId: string): string {
  return join(resolveAgentDir(config, agentId), 'credentials');
}

/**
 * Resolve agent's private auth-profiles.json path
 */
export function resolveAgentAuthProfilesPath(config: Config, agentId: string): string {
  return join(resolveAgentCredentialsDir(config, agentId), FILENAMES.CREDENTIALS_PROFILES);
}

/**
 * Agent session store root. Transcript files are stored in subfolders (users/…, system/cron, …), not as a flat list.
 */
export function resolveSessionsDir(config: Config, agentId: string): string {
  return resolveSessionsDirScoped(config, agentId);
}

/**
 * Resolve the sessions index file path
 */
export function resolveSessionsIndexPath(config: Config, agentId: string): string {
  return join(resolveSessionsDir(config, agentId), FILENAMES.SESSIONS_INDEX);
}

/**
 * Resolve the sessions archive directory
 */
export function resolveSessionsArchiveDir(config: Config, agentId: string): string {
  return join(resolveSessionsDir(config, agentId), 'archive');
}

/**
 * Resolve a session transcript file path, with optional topic sharding.
 * Topic IDs are URL-encoded when they are strings to prevent path traversal.
 */
export function resolveSessionTranscriptPath(
  config: Config,
  sessionId: string,
  agentId: string,
  topicId?: string | number,
): string {
  const safeTopicId =
    typeof topicId === 'string'
      ? encodeURIComponent(topicId)
      : typeof topicId === 'number'
        ? String(topicId)
        : undefined;
  const fileName =
    safeTopicId !== undefined
      ? `${sessionId}-topic-${safeTopicId}.jsonl`
      : `${sessionId}.jsonl`;
  return join(resolveSessionsDir(config, agentId), fileName);
}

/**
 * Resolve a session transcript path within an explicit sessions directory.
 * Useful when the caller already holds a resolved sessions dir (e.g. from config).
 */
export function resolveSessionTranscriptPathInDir(
  sessionId: string,
  sessionsDir: string,
  topicId?: string | number,
): string {
  const safeTopicId =
    typeof topicId === 'string'
      ? encodeURIComponent(topicId)
      : typeof topicId === 'number'
        ? String(topicId)
        : undefined;
  const fileName =
    safeTopicId !== undefined
      ? `${sessionId}-topic-${safeTopicId}.jsonl`
      : `${sessionId}.jsonl`;
  return join(sessionsDir, fileName);
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
 * Per-agent extension install directory (`…/agent/extensions/`), not under the markdown workspace.
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
 * Directory for persisted cron run history (one JSONL file per job id).
 */
export function resolveCronRunsDir(): string {
  return join(resolveCronDir(), 'runs');
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
export function resolveAgentMetadataPath(config: Config, agentId: string): string {
  return join(resolveAgentDir(config, agentId), FILENAMES.AGENT_JSON);
}

/**
 * Resolve per-agent machine state directory (`…/agent/state/`), not under the markdown workspace.
 */
export function resolveWorkspaceStateDir(config: Config, agentId: string): string {
  return join(resolveAgentDir(config, agentId), 'state');
}

/**
 * Resolve the workspace state file path
 */
export function resolveWorkspaceStatePath(config: Config, agentId: string): string {
  return join(resolveWorkspaceStateDir(config, agentId), FILENAMES.WORKSPACE_STATE);
}

/**
 * Resolve the skills cache file path
 */
export function resolveSkillsCachePath(config: Config, agentId: string): string {
  return join(resolveWorkspaceStateDir(config, agentId), FILENAMES.SKILLS_CACHE);
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
