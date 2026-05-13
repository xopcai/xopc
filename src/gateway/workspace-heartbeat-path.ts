import { join } from 'node:path';

import type { Config } from '../config/schema.js';
import { getWorkspacePath } from '../config/schema.js';
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from '../agent/agent-scope.js';
import { WORKSPACE_FILES } from '../config/paths.js';

/** Resolved absolute path to `HEARTBEAT.md` in the agent workspace root. */
export function resolveHeartbeatMdPath(config: Config): string | null {
  if (!getWorkspacePath(config)) {
    return null;
  }
  const aid = resolveDefaultAgentId(config);
  return join(resolveAgentWorkspaceDir(config, aid), WORKSPACE_FILES.HEARTBEAT);
}
