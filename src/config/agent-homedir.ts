import { join } from 'node:path';

import { ENV_VARS, resolveAgentId, resolveStateDir } from './paths-state.js';

/**
 * Per-agent home: `stateDir/agents/<id>/` (sessions + `agent/` subtree).
 * `XOPCBOT_AGENT_DIR` overrides this entire directory (OpenClaw-compatible).
 */
export function resolveAgentHomeDir(
  agentId?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const id = agentId ?? resolveAgentId(env);
  if (env[ENV_VARS.AGENT_DIR]) {
    return env[ENV_VARS.AGENT_DIR]!;
  }
  return join(resolveStateDir(env), 'agents', id);
}
