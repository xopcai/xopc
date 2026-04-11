import type { Config } from './schema.js';
import { resolveAgentBootstrapDir, resolveAgentWorkspaceDir } from './agent-profile.js';
import { getDefaultAgentId } from '../routing/resolve-route.js';

/**
 * Return the deduplicated list of workspace directory paths for all agents
 * defined in `config.agents.list`, plus the default agent.
 * Useful for file watchers, doctor checks, and batch workspace operations.
 */
export function listAgentWorkspaceDirs(config: Config): string[] {
  const dirs = new Set<string>();

  const list = config.agents?.list;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
        dirs.add(resolveAgentWorkspaceDir(config, entry.id));
      }
    }
  }

  dirs.add(resolveAgentWorkspaceDir(config, getDefaultAgentId(config)));
  return [...dirs];
}

/** Per-agent bootstrap (persona Markdown) roots under `~/.xopcbot/agents/<id>/bootstrap`. */
export function listAgentBootstrapDirs(config: Config): string[] {
  const dirs = new Set<string>();
  const list = config.agents?.list;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
        dirs.add(resolveAgentBootstrapDir(config, entry.id));
      }
    }
  }
  dirs.add(resolveAgentBootstrapDir(config, getDefaultAgentId(config)));
  return [...dirs];
}
