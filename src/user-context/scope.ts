import type { UserContextScope } from './domain.js';

export interface UserContextScopeTarget {
  sessionKey: string;
  workspaceId: string;
  projectId?: string;
}

export function matchesUserContextScope(
  scope: UserContextScope,
  target: UserContextScopeTarget,
): boolean {
  if (scope.type === 'global') return true;
  if (scope.type === 'session') return scope.id === target.sessionKey;
  if (scope.type === 'workspace') return scope.id === target.workspaceId;
  return Boolean(target.projectId && scope.id === target.projectId);
}
