import type { LocalAppResourceScope, LocalAppResourceScopes } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { resourceScopePredicate } from '../../storage/sqlite/resource-scope.js';

export function localAppResourceAllowed(extensionId: string, scopes: LocalAppResourceScopes, capabilityId: string, input: unknown): boolean {
  if (capabilityId === 'xopc.agent.delegate') {
    const sources = (input as { sources?: Array<{ capabilityId: string; id: string }> })?.sources ?? [];
    return scopes.agentDelegate === true && sources.every(source => ['xopc.notes.get', 'xopc.tasks.get'].includes(source.capabilityId)
      && localAppResourceAllowed(extensionId, scopes, source.capabilityId, source));
  }
  const args = input as { id?: string; projectId?: string; trigger?: string; patch?: Record<string, unknown> };
  if (capabilityId === 'xopc.notes.update' && (args.trigger || args.patch && (
    ['ai', 'aiDeep', 'localVersion'].some(key => Object.hasOwn(args.patch!, key)) || args.patch.status === 'trashed'
  ))) return false;
  const note = capabilityId.startsWith('xopc.notes.');
  const write = ['xopc.notes.create', 'xopc.notes.update', 'xopc.notes.append'].includes(capabilityId);
  const scope = note ? write ? scopes.notesWrite : scopes.notesRead : scopes.tasksRead;
  if (scope.mode === 'none') return false;
  if (capabilityId === 'xopc.notes.create') {
    if (scope.mode === 'workspace') return true;
    return args.projectId ? scope.projectIds.includes(args.projectId) : scope.includeCreated;
  }
  if (capabilityId.endsWith('.list')) return true;
  const kind = note ? 'note' : 'task';
  return resourceExistsInScope(kind, args.id, extensionId, scope);
}

export function resourceExistsInScope(kind: 'note' | 'task', id: string | undefined, extensionId: string, scope: LocalAppResourceScope): boolean {
  if (!id) return false;
  const restriction = resourceScopePredicate(kind, { extensionId, scope });
  const table = kind === 'note' ? 'notes' : 'tasks';
  const column = kind === 'note' ? 'note_id' : 'task_id';
  return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? AND ${restriction.sql}`)
    .get(id, ...restriction.params));
}
