import { resolveEffectiveAgentProfileForSession } from '../config/agent-profile.js';
import type { Config } from '../config/schema.js';
import {
  getSessionMetadata,
  isXopcDatabaseOpen,
} from '../storage/sqlite/index.js';
import { projectWorkspacePath } from '../session/session-workspace.js';
import { ProjectStore } from './project-store.js';
import type { Project } from './types.js';

export function resolveProjectWorkspacePath(
  config: Config,
  sessionKey: string,
  project: Project | null,
): string {
  const projectWorkspace = projectWorkspacePath(project);
  if (projectWorkspace) {
    return projectWorkspace;
  }
  return resolveEffectiveAgentProfileForSession(config, sessionKey).resolvedWorkspacePath;
}

export function getProjectForSession(sessionKey: string): Project | null {
  if (!isXopcDatabaseOpen()) {
    return null;
  }
  const projectId = getSessionMetadata(sessionKey)?.projectId;
  if (!projectId) {
    return null;
  }
  return new ProjectStore().get(projectId);
}

export function getProjectWorkspacePathForSession(sessionKey: string): string | null {
  return projectWorkspacePath(getProjectForSession(sessionKey));
}
