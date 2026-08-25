import { isXopcDatabaseOpen } from '../storage/sqlite/index.js';
import { TaskContextRepository } from './task-context-repository.js';
import { TaskConversationRepository } from './task-conversation-repository.js';
import { TaskRepository, type TaskAggregate } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';

export interface TaskContextAllocation {
  profile: 'standard' | 'deep' | 'critical';
  maxResults: number;
  maxChars: number;
  reason: string;
}

export interface TaskContextManifest {
  taskId: string;
  sources: Array<{ kind: string; id: string; description: string }>;
  assumptions: string[];
  unresolvedCriteria: string[];
  allocation: 'deep' | 'critical';
}

export interface AssembledTaskContext {
  taskId?: string;
  retrievalQuery: string;
  allocation: TaskContextAllocation;
  manifest?: TaskContextManifest;
}

export interface TaskExecutionBrief {
  task: TaskAggregate;
  remainingCriteria: string[];
  allocation: TaskContextAllocation;
  manifest: TaskContextManifest;
  latestReceipt?: ReturnType<TaskRunRepository['getReceipt']>;
}

const STANDARD: TaskContextAllocation = {
  profile: 'standard', maxResults: 12, maxChars: 12_000,
  reason: 'No active task requires expanded context.',
};

function taskIdForSession(sessionKey: string): string | undefined {
  return new TaskConversationRepository().resolveActiveExecutionSession(sessionKey)?.taskId;
}

export function getTaskExecutionBrief(taskId: string): TaskExecutionBrief | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const task = new TaskRepository().get(taskId);
  if (!task?.contract) return undefined;
  const runs = new TaskRunRepository();
  const latestRun = runs.getLatestRoot(taskId);
  const latestReceipt = latestRun ? runs.getReceipt(latestRun.id) : undefined;
  const remainingCriteria = latestReceipt?.verification.checks.length
    ? latestReceipt.verification.checks.filter((check) => check.status !== 'passed').map((check) => check.criterion)
    : task.contract.acceptanceCriteria;
  const critical = task.priority === 'critical' || task.contract.risks.length > 0
    || task.contract.approvalRequired.length > 0;
  const allocation: TaskContextAllocation = critical
    ? { profile: 'critical', maxResults: 32, maxChars: 64_000, reason: 'Task risk or authority boundaries require full context.' }
    : { profile: 'deep', maxResults: 20, maxChars: 32_000, reason: 'An active task benefits from complete context.' };
  const edges = new TaskContextRepository().list(taskId);
  const manifest: TaskContextManifest = {
    taskId,
    sources: [
      { kind: 'task_contract', id: `${taskId}:${task.contract.version}`, description: 'Current task contract' },
      ...edges.map((edge) => ({ kind: edge.targetKind, id: edge.targetId, description: edge.title ?? edge.role })),
      ...(latestReceipt ? [{ kind: 'task_run_receipt', id: latestReceipt.runId, description: 'Latest run result' }] : []),
    ],
    assumptions: task.contract.assumptions,
    unresolvedCriteria: remainingCriteria,
    allocation: critical ? 'critical' : 'deep',
  };
  return { task, remainingCriteria, allocation, manifest, ...(latestReceipt ? { latestReceipt } : {}) };
}

export function getTaskContextManifest(taskId: string): TaskContextManifest | undefined {
  return getTaskExecutionBrief(taskId)?.manifest;
}

export function assembleTaskContext(sessionKey: string, userQuery: string): AssembledTaskContext {
  const query = userQuery.trim();
  if (!isXopcDatabaseOpen()) return { retrievalQuery: query, allocation: STANDARD };
  const taskId = taskIdForSession(sessionKey);
  if (!taskId) return { retrievalQuery: query, allocation: STANDARD };
  const brief = getTaskExecutionBrief(taskId);
  if (!brief) return { taskId, retrievalQuery: query, allocation: STANDARD };
  const { task, latestReceipt, remainingCriteria, allocation, manifest } = brief;
  const handoff = new TaskConversationRepository().getLatestHandoff(taskId);
  const handoffPayload = handoff?.toSessionKey === sessionKey
    ? JSON.stringify(handoff.payload).slice(0, 12_000)
    : '';
  const contract = task.contract!;
  const sections = [query, `Task: ${contract.objective}`,
    contract.expectedOutputs.length ? `Expected outputs: ${contract.expectedOutputs.join('; ')}` : '',
    remainingCriteria.length ? `Remaining acceptance criteria: ${remainingCriteria.join('; ')}` : '',
    contract.constraints.length ? `Constraints: ${contract.constraints.join('; ')}` : '',
    contract.risks.length ? `Risks: ${contract.risks.join('; ')}` : '',
    latestReceipt?.summary ? `Latest run: ${latestReceipt.summary}` : '',
    handoffPayload ? `Handoff snapshot: ${handoffPayload}` : ''].filter(Boolean);
  return { taskId, retrievalQuery: sections.join('\n'), allocation, manifest };
}

export function buildTaskExecutionDirective(sessionKey: string): string {
  const taskId = isXopcDatabaseOpen() ? taskIdForSession(sessionKey) : undefined;
  const brief = taskId ? getTaskExecutionBrief(taskId) : undefined;
  if (!brief) return '';
  const { task, remainingCriteria } = brief;
  const handoff = new TaskConversationRepository().getLatestHandoff(task.id);
  const handoffPayload = handoff?.toSessionKey === sessionKey
    ? JSON.stringify(handoff.payload).slice(0, 12_000)
    : '';
  const contract = task.contract!;
  return [
    '<xopc_task_execution>',
    'This conversation is executing a durable task.',
    `Task: ${contract.objective}`,
    `Expected outputs: ${contract.expectedOutputs.join('; ')}`,
    `Remaining acceptance criteria: ${remainingCriteria.join('; ')}`,
    contract.constraints.length ? `Constraints: ${contract.constraints.join('; ')}` : '',
    contract.approvalRequired.length ? `Authority required: ${contract.approvalRequired.join('; ')}` : '',
    handoffPayload ? `Handoff snapshot: ${handoffPayload}` : '',
    'Take safe in-scope steps and produce inspectable evidence. Do not claim completion without verification.',
    '</xopc_task_execution>',
  ].filter(Boolean).join('\n');
}
