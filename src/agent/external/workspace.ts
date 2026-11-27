import { mkdir, realpath, stat } from 'node:fs/promises';

import { getExecutionEnvironmentForSession } from '../../execution-environments/subject.js';
import { getProjectForSession } from '../../projects/workspace.js';
import {
  normalizeWorkingDirectoryInput,
  projectWorkspacePath,
} from '../../session/session-workspace.js';
import { getSessionConfig } from '../../storage/sqlite/config-repository.js';
import { isXopcDatabaseOpen } from '../../storage/sqlite/connection.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from '../agent-scope.js';

export type ResolvedExternalSessionWorkspace = {
  path: string;
  isExecutionEnvironment: boolean;
};

/**
 * Resolve the workspace directory for an external runtime session using the same precedence
 * as built-in agents:
 * 1. Bound execution environment (e.g. managed worktree / local checkout)
 * 2. Attached Project workspace root
 * 3. Explicit caller workspace override (headless CLI / automation / channel)
 * 4. Persisted per-session `workingDirectoryOverride`
 * 5. Agent's configured workspace or automatic default workspace (`~/.xopc/workspace-<agentId>`)
 */
export function resolveExternalSessionWorkspace(params: {
  conversationId: string;
  agentId?: string;
  workspaceOverride?: string;
}): ResolvedExternalSessionWorkspace {
  const { conversationId } = params;
  const environment = isXopcDatabaseOpen() ? getExecutionEnvironmentForSession(conversationId) : null;
  if (environment) {
    return { path: environment.rootPath, isExecutionEnvironment: true };
  }

  const project = isXopcDatabaseOpen() ? getProjectForSession(conversationId) : null;
  const projectWorkspace = projectWorkspacePath(project);
  if (projectWorkspace) {
    return { path: projectWorkspace, isExecutionEnvironment: false };
  }

  const explicit = params.workspaceOverride?.trim();
  if (explicit) {
    const normalized = normalizeWorkingDirectoryInput(explicit);
    if (normalized.ok) {
      return { path: normalized.path, isExecutionEnvironment: false };
    }
  }

  const sessionConfig = isXopcDatabaseOpen() ? getSessionConfig(conversationId) : null;
  const sessionOverride = sessionConfig?.workingDirectoryOverride?.trim();
  if (sessionOverride) {
    const normalized = normalizeWorkingDirectoryInput(sessionOverride);
    if (normalized.ok) {
      return { path: normalized.path, isExecutionEnvironment: false };
    }
  }

  const agentId =
    params.agentId?.trim()
    || (isXopcDatabaseOpen() ? getSessionMetadata(conversationId)?.agentId?.trim() : undefined)
    || resolveDefaultAgentId();

  return {
    path: resolveAgentWorkspaceDir(agentId),
    isExecutionEnvironment: false,
  };
}

/**
 * Resolve and materialize (when not an execution environment) the canonical workspace directory
 * (`realpath`) for an external runtime session, matching built-in agent `SessionHydrator.workspace`.
 */
export async function ensureExternalSessionWorkspaceCwd(params: {
  conversationId: string;
  agentId?: string;
  workspaceOverride?: string;
}): Promise<string> {
  const environment = isXopcDatabaseOpen() ? getExecutionEnvironmentForSession(params.conversationId) : null;
  if (environment) {
    if (environment.status !== 'ready') {
      throw new Error(`Execution environment ${environment.id} is ${environment.status}`);
    }
    const rootIsDirectory = await stat(environment.rootPath)
      .then((value) => value.isDirectory())
      .catch(() => false);
    if (!rootIsDirectory) {
      throw new Error(`Execution environment root is unavailable: ${environment.rootPath}`);
    }
    return realpath(environment.rootPath);
  }

  const resolved = resolveExternalSessionWorkspace(params);
  await mkdir(resolved.path, { recursive: true });
  return realpath(resolved.path);
}
