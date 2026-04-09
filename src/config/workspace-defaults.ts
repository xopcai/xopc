import { join } from 'node:path';

import { expandWorkspacePathString } from './workspace-path.js';
import { resolveAgentId, resolveStateDir } from './paths-state.js';

/**
 * Default Markdown workspace for the primary agent (`main` when using heuristics).
 * `XOPCBOT_WORKSPACE` overrides (CLI / gateway).
 */
export function resolveDefaultAgentWorkspaceDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.XOPCBOT_WORKSPACE?.trim();
  if (fromEnv) {
    return expandWorkspacePathString(fromEnv);
  }
  return join(resolveStateDir(env), 'workspace');
}

/**
 * Heuristic workspace path without a loaded config (OpenClaw: `workspace` vs `workspace-<id>`).
 * With config, use `resolveAgentWorkspaceDir` from `agent-profile.js`.
 */
export function resolveWorkspaceDir(
  agentId?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const id = (agentId ?? resolveAgentId(env)).toLowerCase();
  if (id === 'main') {
    return resolveDefaultAgentWorkspaceDir(env);
  }
  return join(resolveStateDir(env), `workspace-${id}`);
}
