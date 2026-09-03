import { join, resolve } from 'node:path';

import { resolveStateDir } from '../config/paths-state.js';

const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9._-]+$/;

function safePathSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || !SAFE_PATH_SEGMENT.test(normalized) || normalized === '.' || normalized === '..') {
    throw new Error(`${label} contains unsupported path characters`);
  }
  return normalized;
}

export function resolveExecutionWorktreesRoot(stateDir = resolveStateDir()): string {
  return resolve(stateDir, 'worktrees');
}

export function resolveManagedWorktreePath(
  projectId: string,
  environmentId: string,
  stateDir = resolveStateDir(),
): string {
  return join(
    resolveExecutionWorktreesRoot(stateDir),
    safePathSegment(projectId, 'projectId'),
    safePathSegment(environmentId, 'environmentId'),
  );
}
