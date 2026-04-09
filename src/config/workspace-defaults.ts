import { join } from 'node:path';

import { expandWorkspacePathString } from './workspace-path.js';
import { resolveAgentId, resolveStateDir } from './paths-state.js';

/**
 * Default Markdown workspace for the primary agent (`main` when using heuristics).
 * `XOPCBOT_WORKSPACE` overrides (CLI / gateway).
 */
export function resolveDefaultAgentWorkspaceDir(): string {
  const fromEnv = process.env.XOPCBOT_WORKSPACE?.trim();
  if (fromEnv) {
    return expandWorkspacePathString(fromEnv);
  }
  return join(resolveStateDir(), 'workspace');
}

/**
 * Heuristic workspace path without a loaded config (OpenClaw: `workspace` vs `workspace-<id>`).
 * With config, use `resolveAgentWorkspaceDir` from `agent-profile.js`.
 */
export function resolveWorkspaceDir(agentId?: string): string {
  const id = (agentId ?? resolveAgentId()).toLowerCase();
  if (id === 'main') {
    return resolveDefaultAgentWorkspaceDir();
  }
  return join(resolveStateDir(), `workspace-${id}`);
}
