import type { AgentTool } from '@earendil-works/pi-agent-core';

import { PERSONAL_MAIN_TOOL_IDS } from '../../personal-agent/policy.js';
import { isPersonalConversation } from '../../personal-agent/repository.js';
import { personalRequestForExecution } from '../../personal-agent/request-repository.js';
import { isXopcDatabaseOpen } from '../../storage/sqlite/connection.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';

export const TASK_EXECUTION_TOOL_IDS: readonly string[] = ['task_collaboration', 'publish_task_result'];

export const PERSONAL_REQUEST_TOOL_IDS = [
  'tool_search', 'xopc_tool_describe', 'xopc_tool_execute',
  'personal_request_result', 'personal_request_connection', 'task_collaboration',
] as const;

export type ExecutionToolPolicy = Readonly<{
  surface: 'agent' | 'personal_main' | 'personal_request_worker';
  taskExecution: boolean;
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
  const taskExecution = Boolean(isXopcDatabaseOpen()
    && new TaskConversationRepository().resolveActiveExecutionSession(conversationId));
  return { surface, taskExecution, nativeMcp: configured, externalMaterialization: configured,
    discovery: configured, codemode: configured, revision: 'unified-tool-discovery-v1' };
}

export function allowsExecutionTool(policy: ExecutionToolPolicy, name: string): boolean {
  if (TASK_EXECUTION_TOOL_IDS.includes(name) && !policy.taskExecution) return false;
  if (policy.surface === 'agent') return !name.startsWith('personal_');
  const names: readonly string[] = policy.surface === 'personal_main' ? PERSONAL_MAIN_TOOL_IDS : PERSONAL_REQUEST_TOOL_IDS;
  return names.includes(name);
}

export function filterExecutionTools(policy: ExecutionToolPolicy, tools: readonly AgentTool[]): AgentTool[] {
  return tools.filter(tool => allowsExecutionTool(policy, tool.name));
}
