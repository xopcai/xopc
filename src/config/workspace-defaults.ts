import { join } from 'node:path';

import { expandWorkspacePathString } from './workspace-path.js';
import { resolveStateDir } from './paths-state.js';

/**
 * Default Markdown workspace for the primary agent when `agents.defaults.workspace` is unset and
 * there is no per-list `workspace` — `<stateDir>/workspace/main`, unless `XOPC_WORKSPACE` is set.
 */
export function resolveDefaultAgentWorkspaceDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.XOPC_WORKSPACE?.trim();
  if (fromEnv) {
    return expandWorkspacePathString(fromEnv);
  }
  // Leaf `main` must match DEFAULT_AGENT_ID in agent-scope.ts (avoid importing it here → cycle).
  return join(resolveStateDir(env), 'workspace', 'main');
}
