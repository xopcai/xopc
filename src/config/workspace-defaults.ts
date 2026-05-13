import { join } from 'node:path';

import { expandWorkspacePathString } from './workspace-path.js';
import { ENV_VARS, resolveStateDir } from './paths-state.js';

/**
 * Default Markdown workspace for the primary agent.
 *
 * OpenClaw-aligned: `<stateDir>/workspace` (no `/main` suffix).
 * When `XOPC_PROFILE` is set (and not `default`), returns `<stateDir>/workspace-<profile>`.
 */
export function resolveDefaultAgentWorkspaceDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.XOPC_WORKSPACE?.trim();
  if (fromEnv) {
    return expandWorkspacePathString(fromEnv);
  }
  const stateDir = resolveStateDir(env);
  const profile = env[ENV_VARS.PROFILE]?.trim();
  if (profile && profile.toLowerCase() !== 'default') {
    return join(stateDir, `workspace-${profile}`);
  }
  return join(stateDir, 'workspace');
}
