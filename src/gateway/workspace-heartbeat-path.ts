import { dirname, join, resolve } from 'node:path';

import type { Config } from '../config/schema.js';
import { getWorkspacePath } from '../config/schema.js';

/** Resolved absolute path to workspace `HEARTBEAT.md`, or null if workspace is invalid. */
export function resolveHeartbeatMdPath(config: Config): string | null {
  const workspaceRoot = getWorkspacePath(config);
  if (!workspaceRoot) return null;
  const root = resolve(workspaceRoot);
  const file = resolve(join(root, 'HEARTBEAT.md'));
  if (dirname(file) !== root) return null;
  return file;
}
