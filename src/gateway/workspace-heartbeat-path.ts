import { join } from 'node:path';

import type { Config } from '../config/schema.js';
import { getWorkspacePath } from '../config/schema.js';
import { resolveAgentProfileDir, resolveDefaultAgentId } from '../agent/agent-scope.js';
import { WORKSPACE_FILES } from '../config/paths.js';

/** Resolved absolute path to `HEARTBEAT.md` under the default agent's `profile/` directory. */
export function resolveHeartbeatMdPath(config: Config): string | null {
  if (!getWorkspacePath(config)) {
    return null;
  }
  const aid = resolveDefaultAgentId(config);
  return join(resolveAgentProfileDir(config, aid), WORKSPACE_FILES.HEARTBEAT);
}
