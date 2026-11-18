import type { TaskRun } from '@xopcai/gateway-contract';

import { loadLlmMessagesForSession } from '../storage/sqlite/transcript-repository.js';
import { savedExecutionRequirements } from './task-execution-capabilities.js';
import type { TaskAggregate } from './task-repository.js';

const READ_TOOLS = new Set([
  'read_file', 'list_dir', 'list_directory', 'find', 'grep', 'read_media',
  'web_search', 'web_fetch', 'web_extract', 'knowledge_search', 'knowledge_get', 'knowledge_read',
  'session_status', 'session_search', 'session_recall', 'user_context_search', 'user_context_get',
  'skills_list', 'skill_view', 'tool_manual', 'tool_search', 'workbook_read',
]);

export function allowsReadOnlyRetryTool(name: string): boolean {
  return READ_TOOLS.has(name) || name === 'task_collaboration' || name === 'publish_task_result';
}

export function isReadOnlyTaskRetry(task: TaskAggregate, run: TaskRun): boolean {
  if (task.contract?.outputDestinations.length || task.contract?.approvalRequired.length) return false;
  const plan = savedExecutionRequirements(task.id);
  if (plan && (plan.contractVersion !== run.contractVersion || plan.requirements.connector
    || plan.needs.some(need => !['read_input', 'web_research'].includes(need.capability))
    || plan.requirements.requiredTools?.some(name => !allowsReadOnlyRetryTool(name)))) return false;
  const messages = run.conversationId ? loadLlmMessagesForSession(run.conversationId) : [];
  const toolsUsed = messages.flatMap(message => message.role === 'toolResult' ? [message.toolName] : message.role === 'assistant'
    ? message.content.flatMap(part => part.type === 'toolCall' ? [part.name] : []) : []);
  return toolsUsed.every(allowsReadOnlyRetryTool)
    && (Boolean(plan?.needs.length) || toolsUsed.some(name => READ_TOOLS.has(name)));
}

export function isReadOnlyRetryDecision(condition: Record<string, unknown>, connected: boolean): boolean {
  if (condition.type !== 'run_decision'
    || !['tool_outcome_unconfirmed', 'execution_interrupted'].includes(String(condition.reasonCode))) return false;
  const operation = condition.operation as { toolName?: string } | undefined;
  return !operation?.toolName || allowsReadOnlyRetryTool(operation.toolName)
    || (connected && ['xopc_tool_execute', 'xopc_tool_describe', 'tool_search'].includes(operation.toolName));
}
