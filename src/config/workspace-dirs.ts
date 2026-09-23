import { listAgentEntries } from '../agent/agent-scope.js';
import { resolveAgentWorkspaceDir } from './agent-profile.js';
import { getDefaultAgentId } from '../routing/resolve-route.js';

/**
 * Return the deduplicated list of workspace directory paths for all agents
 * stored in the SQLite Agent catalog, plus the default Agent.
 * Useful for file watchers, doctor checks, and batch workspace operations.
 *
 * OpenClaw-aligned: profile / persona files live in the workspace root,
 * so this single list covers both workspace and profile Markdown directories.
 */
export function listAgentWorkspaceDirs(): string[] {
  const dirs = new Set<string>();

  const list = listAgentEntries();
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
        dirs.add(resolveAgentWorkspaceDir(entry.id));
      }
    }
  }

  dirs.add(resolveAgentWorkspaceDir(getDefaultAgentId()));
  return [...dirs];
}

/**
 * OpenClaw-aligned: profile Markdown files live in the workspace root, so profile dirs match workspace dirs.
 */
export function listAgentProfileMarkdownDirs(): string[] {
  return listAgentWorkspaceDirs();
}
