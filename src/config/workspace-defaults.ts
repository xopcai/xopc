import { join } from 'node:path';

import { expandWorkspacePathString } from './workspace-path.js';
import { resolveStateDir } from './paths-state.js';

/**
 * Default Markdown workspace when only `XOPC_WORKSPACE` / state heuristics apply (no `agents.list` yet).
 */
export function resolveDefaultAgentWorkspaceDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.XOPC_WORKSPACE?.trim();
  if (fromEnv) {
    return expandWorkspacePathString(fromEnv);
  }
  return join(resolveStateDir(env), 'workspace');
}
