import type { AgentTool } from '@earendil-works/pi-agent-core';

import { getSessionInteractionPolicy, isReadOnlySessionTool } from '../session/interaction-policy.js';
import { getExecutionAuthority } from '../../infra/execution-authority.js';
import { PERSONAL_MAIN_TOOL_IDS } from '../../personal-agent/policy.js';
import { isPersonalConversation } from '../../personal-agent/repository.js';
import { personalRequestForExecution } from '../../personal-agent/request-repository.js';
import { getXopcDatabase, isXopcDatabaseOpen } from '../../storage/sqlite/connection.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';

export const TASK_EXECUTION_TOOL_IDS: readonly string[] = ['task_collaboration', 'publish_task_result'];

export const PERSONAL_REQUEST_TOOL_IDS = [
  'tool_search', 'xopc_tool_describe', 'xopc_tool_execute',
  'personal_request_result', 'personal_request_connection', 'task_collaboration', 'publish_task_result',
] as const;

export type ExecutionToolPolicy = Readonly<{
  surface: 'agent' | 'personal_main' | 'personal_request_worker';
  taskExecution: boolean;
  privateRoutine?: boolean;
  readOnly?: boolean;
  nativeMcp: boolean;
  externalMaterialization: boolean;
  discovery: boolean;
  codemode: boolean;
  revision: string;
}>;

/** Resolve from persisted execution identity, never from tool names or model input. */
export function resolveExecutionToolPolicy(conversationId: string): ExecutionToolPolicy {
  let surface: ExecutionToolPolicy['surface'] = 'agent';
  if (isPersonalConversation(conversationId)) surface = 'personal_main';
  else if (personalRequestForExecution(conversationId)
    || (isXopcDatabaseOpen() && getSessionMetadata(conversationId)?.customData?.personalReadRequestId)) {
    surface = 'personal_request_worker';
  }
  const configured = surface === 'agent';
  const authority = getExecutionAuthority();
  const interaction = getSessionInteractionPolicy(conversationId);
  const readOnly = interaction.mode === 'plan' || interaction.access === 'read-only';
  const taskSession = isXopcDatabaseOpen() ? new TaskConversationRepository().resolveActiveExecutionSession(conversationId) : undefined;
  const privateRoutine = Boolean(taskSession && getXopcDatabase().db.prepare(`SELECT 1 FROM observation_routine_executions WHERE task_id=?
    UNION ALL SELECT 1 FROM observation_methods WHERE validation_task_id=?
    UNION ALL SELECT 1 FROM home_observation_trials WHERE task_id=? LIMIT 1`).get(taskSession.taskId, taskSession.taskId, taskSession.taskId));
  const unrestricted = !privateRoutine && configured && !readOnly && (!authority || authority.unrestrictedTools);
  const taskExecution = Boolean(taskSession);
  return { surface, taskExecution, privateRoutine, readOnly, nativeMcp: unrestricted, externalMaterialization: unrestricted,
    discovery: unrestricted, codemode: unrestricted, revision: `unified-tool-discovery-v1:${interaction.mode}:${interaction.access}:${interaction.sandbox ?? 'configured'}:${interaction.network ?? false}:${authority?.revision ?? ''}:${privateRoutine ? 'private-routine' : ''}` };
}

export function allowsExecutionTool(policy: ExecutionToolPolicy, name: string): boolean {
  const authority = getExecutionAuthority();
  authority?.assertCurrent();
  if (policy.privateRoutine && !PRIVATE_ROUTINE_TOOLS.has(name)) return false;
  if (policy.readOnly && !isReadOnlySessionTool(name)) return false;
  if (authority && !authority.allowsTool(name)) return false;
  if (TASK_EXECUTION_TOOL_IDS.includes(name) && !policy.taskExecution) return false;
  if (policy.surface === 'agent') return !name.startsWith('personal_');
  const names: readonly string[] = policy.surface === 'personal_main' ? PERSONAL_MAIN_TOOL_IDS : PERSONAL_REQUEST_TOOL_IDS;
  return names.includes(name);
}

export function filterExecutionTools(policy: ExecutionToolPolicy, tools: readonly AgentTool[]): AgentTool[] {
  return tools.filter(tool => allowsExecutionTool(policy, tool.name));
}

// Private routines can read evidence and finalize their Task, never delegate or mutate external systems.
const PRIVATE_ROUTINE_TOOLS = new Set([
  'read_file', 'list_dir', 'list_directory', 'find', 'grep', 'web_search', 'web_fetch',
  'knowledge_search', 'knowledge_get', 'knowledge_read', 'session_status', 'session_search', 'session_recall',
  'user_context_search', 'user_context_get', 'skills_list', 'skill_view', 'tool_manual', 'publish_task_result',
]);
