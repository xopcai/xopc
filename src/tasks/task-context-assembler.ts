import type { TaskContextManifest } from '@xopcai/gateway-contract';

import {
  getSessionMetadata,
  isXopcDatabaseOpen,
  listExecutionReceipts,
} from '../storage/sqlite/index.js';
import { TaskRepository, type TaskAggregate } from './task-repository.js';

export interface TaskContextAllocation {
  profile: 'standard' | 'deep' | 'critical';
  maxResults: number;
  maxChars: number;
  reason: string;
}

export interface AssembledTaskContext {
  taskId?: string;
  retrievalQuery: string;
  allocation: TaskContextAllocation;
  manifest?: TaskContextManifest;
}

type LatestExecutionReceipt = ReturnType<typeof listExecutionReceipts>[number];

export interface TaskExecutionBrief {
  task: TaskAggregate;
  remainingCriteria: string[];
  allocation: TaskContextAllocation;
  manifest: TaskContextManifest;
  latestReceipt?: LatestExecutionReceipt;
}

const STANDARD: TaskContextAllocation = {
  profile: 'standard',
  maxResults: 12,
  maxChars: 12_000,
  reason: 'No active task requires expanded context.',
};

function taskIdForSession(sessionKey: string): string | undefined {
  const value = getSessionMetadata(sessionKey)?.customData?.taskId;
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

function taskAllocation(
  task: TaskAggregate,
  latestReceipt: LatestExecutionReceipt | undefined,
): TaskContextAllocation {
  const contract = task.contract!;
  const critical = task.priority === 'critical'
    || contract.risks.length > 0
    || contract.approvalRequired.length > 0;
  if (critical) {
    return {
      profile: 'critical',
      maxResults: 32,
      maxChars: 64_000,
      reason: 'The task contains material risk or approval boundaries.',
    };
  }
  const running = task.status === 'running'
    || latestReceipt?.completionVerdict === 'partial'
    || latestReceipt?.completionVerdict === 'not_achieved';
  return running
    ? {
        profile: 'deep',
        maxResults: 24,
        maxChars: 40_000,
        reason: 'The task is running after incomplete or failed work.',
      }
    : {
        profile: 'deep',
        maxResults: 20,
        maxChars: 32_000,
        reason: 'An active task benefits from complete user and decision context.',
      };
}

export function getTaskExecutionBrief(taskId: string): TaskExecutionBrief | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const task = new TaskRepository().get(taskId);
  if (!task?.contract) return undefined;
  const latestReceipt = listExecutionReceipts({ taskId, limit: 1 })[0];
  const remainingCriteria = latestReceipt?.verification.checks
    .filter((check) => check.status !== 'passed')
    .map((check) => check.criterion) ?? task.contract.acceptanceCriteria;
  const allocation = taskAllocation(task, latestReceipt);
  const manifest: TaskContextManifest = {
    taskId,
    sources: [
      {
        kind: 'task_contract',
        id: `${taskId}:${task.contract.version}`,
        description: 'Current task contract and completion criteria',
      },
      ...(latestReceipt ? [{
        kind: 'execution_receipt' as const,
        id: latestReceipt.runId,
        description: 'Latest execution evidence and verification result',
      }] : []),
      ...(latestReceipt?.correctionText ? [{
        kind: 'user_correction' as const,
        id: latestReceipt.runId,
        description: latestReceipt.correctionText,
      }] : []),
    ],
    assumptions: task.contract.assumptions,
    unresolvedCriteria: remainingCriteria,
    allocation: allocation.profile === 'critical' ? 'critical' : 'deep',
  };
  return {
    task,
    remainingCriteria,
    allocation,
    manifest,
    ...(latestReceipt ? { latestReceipt } : {}),
  };
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
  const contract = task.contract!;
  const sections = [
    query,
    `Task: ${contract.objective}`,
    task.execution.contextMessage?.text.trim()
      ? `User-provided context: ${task.execution.contextMessage.text.trim()}`
      : '',
    contract.expectedOutputs.length ? `Expected outputs: ${contract.expectedOutputs.join('; ')}` : '',
    remainingCriteria.length ? `Remaining acceptance criteria: ${remainingCriteria.join('; ')}` : '',
    contract.constraints.length ? `Constraints: ${contract.constraints.join('; ')}` : '',
    contract.assumptions.length ? `Assumptions: ${contract.assumptions.join('; ')}` : '',
    contract.risks.length ? `Risks: ${contract.risks.join('; ')}` : '',
    latestReceipt?.correctionText ? `User correction: ${latestReceipt.correctionText}` : '',
    latestReceipt?.summary ? `Latest execution result: ${latestReceipt.summary}` : '',
  ].filter(Boolean);
  return {
    taskId,
    retrievalQuery: sections.join('\n'),
    allocation,
    ...(manifest ? { manifest } : {}),
  };
}

export function buildTaskExecutionDirective(sessionKey: string): string {
  if (!isXopcDatabaseOpen()) return '';
  const taskId = taskIdForSession(sessionKey);
  if (!taskId) return '';
  const brief = getTaskExecutionBrief(taskId);
  if (!brief) return '';
  const { task, latestReceipt, remainingCriteria } = brief;
  const contract = task.contract!;
  const execution = task.execution;
  const lines = [
    '<xopc_task_execution>',
    'This conversation is executing a durable user task, not merely discussing it.',
    `Task: ${contract.objective}`,
    `Expected outputs: ${contract.expectedOutputs.join('; ')}`,
    `Remaining acceptance criteria: ${remainingCriteria.join('; ')}`,
    execution.contextMessage?.text.trim() ? `User-provided context: ${execution.contextMessage.text.trim()}` : '',
    contract.constraints.length ? `Constraints: ${contract.constraints.join('; ')}` : '',
    contract.approvalRequired.length
      ? `Approval boundaries: ${contract.approvalRequired.join('; ')}`
      : '',
    execution.approvedBoundaries.length
      ? `Already approved boundaries: ${execution.approvedBoundaries.join('; ')}`
      : '',
    latestReceipt?.correctionText ? `User correction: ${latestReceipt.correctionText}` : '',
    latestReceipt?.summary ? `Latest result: ${latestReceipt.summary}` : '',
    'Actively take all safe in-scope steps available. Prefer producing and verifying the result over explaining how to do it.',
    'Choose the simplest sufficient capability: use direct tools for one-off work, workflows for repeatable multi-step orchestration, and automation only for recurring or event-driven work.',
    'Do not claim completion without inspectable evidence for every acceptance criterion.',
    'Ask the user only when a concrete missing decision, permission, or unavailable fact truly blocks progress. If blocked, state what is done, the blocker, your recommendation, and one decision needed.',
    '</xopc_task_execution>',
  ];
  return lines.filter(Boolean).join('\n');
}
