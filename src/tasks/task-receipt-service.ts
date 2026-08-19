import type { TaskReceipt, TaskReceiptStatus } from '@xopcai/gateway-contract';

import {
  getExecutionReceipt,
  listExecutionReceipts,
  type ExecutionReceipt,
} from '../storage/sqlite/index.js';

function receiptStatus(task: ExecutionReceipt): TaskReceiptStatus {
  if (task.status === 'running') return 'running';
  if (task.status === 'cancelled') return 'cancelled';
  if (task.needsUser) return 'needs_user';
  if (task.completionVerdict === 'achieved') return 'completed';
  if (task.completionVerdict === 'partial') return 'partial';
  return 'failed';
}

function remainingWork(task: ExecutionReceipt): string[] {
  const incomplete = task.verification.checks
    .filter((check) => check.status !== 'passed')
    .map((check) => check.criterion);
  if (task.nextAction && !incomplete.includes(task.nextAction)) incomplete.push(task.nextAction);
  return incomplete;
}

export function toTaskReceipt(task: ExecutionReceipt): TaskReceipt {
  return {
    runId: task.runId,
    ...(task.context.taskId ? { taskId: task.context.taskId } : {}),
    ...(task.contractVersion ? { contractVersion: task.contractVersion } : {}),
    sessionKey: task.sessionKey,
    objective: task.objective,
    status: receiptStatus(task),
    summary: task.summary ?? (task.status === 'running' ? 'Work is in progress.' : 'Work finished without a summary.'),
    projectId: task.context.projectId,
    origin: task.context.origin,
    triggerKind: task.context.triggerKind,
    attempt: task.attempt,
    strategy: task.strategy,
    changes: task.evidence.filter((item) => item.kind === 'artifact' || item.kind === 'state'),
    evidence: task.evidence,
    verification: task.verification,
    remainingWork: remainingWork(task),
    nextAction: task.nextAction,
    needsUser: task.needsUser,
    completionVerdict: task.completionVerdict,
    correctionText: task.correctionText,
    contextTraceId: task.context.contextTraceId,
    failure: task.failure,
    judgment: task.judgment,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    feedback: task.feedback,
  };
}

export class TaskReceiptService {
  get(runId: string): TaskReceipt | undefined {
    const task = getExecutionReceipt(runId);
    return task ? toTaskReceipt(task) : undefined;
  }

  list(input: {
    taskId?: string;
    projectId?: string;
    sessionKey?: string;
    limit?: number;
  } = {}): TaskReceipt[] {
    return listExecutionReceipts(input).map(toTaskReceipt);
  }
}
