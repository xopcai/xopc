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
  conversationId: string,
  project: Project | null,
): string {
  const projectWorkspace = projectWorkspacePath(project);
  if (projectWorkspace) {
    return projectWorkspace;
  }
  return resolveEffectiveAgentProfileForSession(conversationId).resolvedWorkspacePath;
}

export function getProjectForSession(conversationId: string): Project | null {
  if (!isXopcDatabaseOpen()) {
    return null;
  }
  const projectId = getSessionMetadata(conversationId)?.projectId;
  if (!projectId) {
    return null;
  }
  return new ProjectStore().get(projectId);
}

export function getProjectWorkspacePathForSession(conversationId: string): string | null {
  return projectWorkspacePath(getProjectForSession(conversationId));
}
