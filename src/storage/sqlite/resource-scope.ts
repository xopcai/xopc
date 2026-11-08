import type { LocalAppResourceScope } from '@xopcai/gateway-contract';

/** Trusted runtime restriction; never accepted as a public query parameter. */
export interface ResourceRestriction {
  extensionId: string;
  scope: LocalAppResourceScope;
}

export function resourceScopePredicate(kind: 'note' | 'task', restriction: ResourceRestriction): { sql: string; params: string[] } {
  const { scope, extensionId } = restriction;
  if (scope.mode === 'workspace') return { sql: '1', params: [] };
  if (scope.mode === 'none') return { sql: '0', params: [] };
  const column = kind === 'note' ? 'notes.note_id' : 'tasks.task_id';
  const params = [JSON.stringify(scope.ids), JSON.stringify(scope.projectIds)];
  const clauses = [`${column} IN (SELECT value FROM json_each(?))`];
  clauses.push(kind === 'note'
    ? `EXISTS (SELECT 1 FROM object_links l JOIN projects p ON p.project_id = l.to_id WHERE l.from_kind = 'note' AND l.from_id = ${column}
        AND l.to_kind = 'project' AND l.relation = 'belongs_to' AND l.to_id IN (SELECT value FROM json_each(?)))`
    : 'tasks.project_id IN (SELECT value FROM json_each(?))');
  if (scope.includeCreated) {
    clauses.push(`EXISTS (SELECT 1 FROM durable_state d WHERE d.namespace = '${kind === 'note' ? 'local-app-owned-notes' : 'local-app-owned-tasks'}'
      AND d.scope = ? AND d.key = ${column})`);
    params.push(extensionId);
  }
  return { sql: `(${clauses.join(' OR ')})`, params };
}
