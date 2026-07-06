/**
 * Per-session markdown workspace override (stored in SessionAgentConfig).
 */

import type { Config } from '../config/schema.js';
import { resolveEffectiveAgentProfileForSession } from '../config/agent-profile.js';
import { resolveUserPath } from '../agent/agent-scope.js';
import { normalizeWorkspaceDir } from '../config/workspace-path.js';
import type { Project } from '../projects/types.js';
import type { SessionAgentConfig } from './config-types.js';

/**
 * Normalize user input for `workingDirectoryOverride`. Rejects empty and filesystem roots.
 */
export function normalizeWorkingDirectoryInput(raw: string): { ok: true; path: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'working directory is empty' };
  }
  const resolved = resolveUserPath(trimmed);
  const normalized = normalizeWorkspaceDir(resolved);
  if (!normalized) {
    return { ok: false, error: 'invalid working directory path' };
  }
  return { ok: true, path: normalized };
}

export function projectWorkspacePath(
  project: Pick<Project, 'workspaceRoot'> | null | undefined,
): string | null {
  const raw = project?.workspaceRoot?.trim();
  if (!raw) return null;
  const resolved = resolveUserPath(raw);
  return normalizeWorkspaceDir(resolved);
}

/**
 * Resolved markdown workspace for tools/shell: project workspace, session override, or merged agent profile default.
 */
export function effectiveWorkspacePathForSession(
  cfg: Config,
  sessionKey: string,
  sessionAgentConfig: SessionAgentConfig | null | undefined,
  project?: Pick<Project, 'workspaceRoot'> | null,
): string {
  const base = resolveEffectiveAgentProfileForSession(cfg, sessionKey).resolvedWorkspacePath;
  const projectWorkspace = projectWorkspacePath(project);
  if (projectWorkspace) {
    return projectWorkspace;
  }
  const o = sessionAgentConfig?.workingDirectoryOverride?.trim();
  if (!o) {
    return base;
  }
  const resolved = resolveUserPath(o);
  const normalized = normalizeWorkspaceDir(resolved);
  return normalized ?? base;
}
