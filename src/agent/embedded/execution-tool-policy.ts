import type { AgentTool } from '@earendil-works/pi-agent-core';

import { PERSONAL_MAIN_TOOL_IDS } from '../../personal-agent/policy.js';
import { isPersonalConversation } from '../../personal-agent/repository.js';
import { personalRequestForExecution } from '../../personal-agent/request-repository.js';
import { isXopcDatabaseOpen } from '../../storage/sqlite/connection.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';

export const PERSONAL_REQUEST_TOOL_IDS = [
  'xopc_tool_search', 'xopc_tool_describe', 'xopc_tool_execute',
  'personal_request_result', 'personal_request_connection', 'task_collaboration',
] as const;

export type ExecutionToolPolicy = Readonly<{
  surface: 'agent' | 'personal_main' | 'personal_request_worker';
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
  return { surface, nativeMcp: configured, externalMaterialization: configured,
    discovery: configured, codemode: configured, revision: 'personal-tool-boundaries-v2' };
}

export function allowsExecutionTool(policy: ExecutionToolPolicy, name: string): boolean {
  if (policy.surface === 'agent') return true;
  const names: readonly string[] = policy.surface === 'personal_main' ? PERSONAL_MAIN_TOOL_IDS : PERSONAL_REQUEST_TOOL_IDS;
  return names.includes(name);
}

export function filterExecutionTools(policy: ExecutionToolPolicy, tools: readonly AgentTool[]): AgentTool[] {
  return tools.filter(tool => allowsExecutionTool(policy, tool.name));
}
