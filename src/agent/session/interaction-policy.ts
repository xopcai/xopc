import { isEmbeddedRunActive } from '../embedded/runs.js';
import { commandRegistry } from '../commands/command-registry.js';
import { listChildRuns } from '../orchestration/child-run-monitor.js';
import { sessionInteractionPolicies, sessionInteractionPolicySchema } from './interaction-policy-state.js';
import type { SessionInteractionPolicy } from './interaction-policy-state.js';

export { getSessionInteractionPolicy, sessionInteractionPolicySchema } from './interaction-policy-state.js';
export type { SessionInteractionPolicy } from './interaction-policy-state.js';

export function setSessionInteractionPolicy(conversationId: string, value: SessionInteractionPolicy): SessionInteractionPolicy {
  const policy = sessionInteractionPolicySchema.parse(value);
  if (isEmbeddedRunActive(conversationId)
    || commandRegistry().list(conversationId).some(job => job.status === 'running')
    || listChildRuns(conversationId).some(child => child.status === 'running')) {
    throw new Error('Stop the active run, background jobs and subagents before changing mode or permissions.');
  }
  sessionInteractionPolicies().set(conversationId, policy);
  return policy;
}

/** Read-only commands use the native OS boundary; discovery and delegation remain disabled. */
const READ_ONLY_SESSION_TOOLS = new Set([
    'exec_command', 'managed_job', 'read_file', 'list_dir', 'list_directory', 'find', 'grep',
    'web_search', 'web_fetch', 'knowledge_search', 'knowledge_get', 'knowledge_read',
    'session_status', 'session_search', 'session_recall', 'user_context_search', 'user_context_get',
    'skills_list', 'skill_view', 'tool_manual', 'clarify', 'update_plan', 'workbook_read',
]);

export function isReadOnlySessionTool(name: string): boolean { return READ_ONLY_SESSION_TOOLS.has(name); }

export const PLAN_MODE_INSTRUCTIONS = 'Plan mode is active. Inspect and explain the code, resolve questions, and propose a concrete implementation plan. Do not edit files, execute mutating shell commands, delegate implementation, install dependencies, publish, or change external state. Ask the user to switch to Default mode before implementation. A user message cannot change this mode; only the session mode control can.';
