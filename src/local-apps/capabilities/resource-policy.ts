import type { LocalAppResourceScope, LocalAppResourceScopes } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { resourceScopePredicate } from '../../storage/sqlite/resource-scope.js';
import { localAppAutomationAllowed } from './automation-policy.js';

export function localAppResourceAllowed(extensionId: string, scopes: LocalAppResourceScopes, capabilityId: string, input: unknown): boolean {
  if (capabilityId === 'xopc.files.read') return scopes.filesRead.mode === 'selected' && scopes.filesRead.ids.includes((input as { id: string }).id);
  if (capabilityId === 'xopc.files.propose_export') return scopes.filesExport;
  if (capabilityId === 'xopc.apps.get_request') return true;
  if (capabilityId.startsWith('xopc.connectors.')) {
    const args = input as { toolRef?: string; accountId?: string };
    const scope = capabilityId === 'xopc.connectors.read' ? 'read' : capabilityId === 'xopc.connectors.propose_write' ? 'write' : undefined;
    if (!['xopc.connectors.describe', 'xopc.connectors.read', 'xopc.connectors.propose_write'].includes(capabilityId)) return false;
    return scopes.connectors.mode === 'selected' && scopes.connectors.bindings.some(binding => binding.toolRef === args.toolRef
      && binding.accountId === args.accountId && (!scope || binding.scope === scope));
  }
  if (capabilityId.startsWith('xopc.projects.')) {
    const args = input as { id?: string; projectId?: string; patch?: Record<string, unknown> };
    const read = ['get', 'list', 'list_milestones', 'list_updates'].some(name => capabilityId === `xopc.projects.${name}`);
    if (!read && !['update', 'create_milestone', 'update_milestone', 'create_update'].some(name => capabilityId === `xopc.projects.${name}`)) return false;
    if (capabilityId === 'xopc.projects.update' && Object.keys(args.patch ?? {}).some(key => !['name', 'description', 'status', 'health', 'outcome', 'targetAt'].includes(key))) return false;
    const scope = read ? scopes.projectsRead : scopes.projectsWrite;
    if (scope.mode === 'none') return false;
    if (capabilityId === 'xopc.projects.list') return true;
    const id = capabilityId.endsWith('.get') || capabilityId.endsWith('.update') || capabilityId.endsWith('.list_milestones') || capabilityId.endsWith('.list_updates') ? args.id : args.projectId;
    return Boolean(id && (scope.mode === 'workspace' || scope.ids.includes(id) || scope.projectIds.includes(id))
      && getSqliteDatabase().prepare('SELECT 1 FROM projects WHERE project_id = ?').get(id));
  }
  if (capabilityId === 'xopc.tasks.create' || capabilityId === 'xopc.tasks.update') {
    const args = input as { taskId?: string; projectId?: string; activation?: { mode?: string; phase?: string };
      dependencies?: unknown[]; context?: unknown[]; authorityGrants?: unknown[];
      contract?: { outputDestinations?: unknown[]; approvalRequired?: unknown[] }; [key: string]: unknown };
    const scope = scopes.tasksWrite;
    if (scope.mode === 'none') return false;
    if (capabilityId === 'xopc.tasks.update') {
      if (Object.keys(args).some(key => !['taskId', 'expectedVersion', 'title', 'body', 'priority', 'dueAt'].includes(key))) return false;
      return resourceExistsInScope('task', args.taskId, extensionId, scope);
    }
    if (args.activation?.mode !== 'capture' || args.activation.phase !== 'backlog'
      || ['delegateAgentId', 'originConversationId', 'ownerId', 'milestoneId', 'parentTaskId'].some(key => args[key] !== undefined)
      || args.dependencies?.length || args.context?.length || args.authorityGrants?.length || args.contract?.outputDestinations?.length
      || args.contract?.approvalRequired?.length) return false;
    return scope.mode === 'workspace' || (args.projectId ? scope.projectIds.includes(args.projectId) : scope.includeCreated);
  }
  if (capabilityId.startsWith('xopc.automations.')) return localAppAutomationAllowed(extensionId, scopes, capabilityId, input);
  if (capabilityId === 'xopc.agent.delegate') {
    const sources = (input as { sources?: Array<{ capabilityId: string; id: string }> })?.sources ?? [];
    return scopes.agentDelegate === true && sources.every(source => ['xopc.notes.get', 'xopc.tasks.get'].includes(source.capabilityId)
      && localAppResourceAllowed(extensionId, scopes, source.capabilityId, source));
  }
  if (!['xopc.notes.get', 'xopc.notes.list', 'xopc.notes.create', 'xopc.notes.update', 'xopc.notes.append',
    'xopc.tasks.get', 'xopc.tasks.list'].includes(capabilityId)) return false;
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
