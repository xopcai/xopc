import type { OutcomeReceipt, OutcomeReceiptStatus } from '@xopcai/gateway-contract';

import {
  getExecutionReceipt,
  listExecutionReceipts,
  type ExecutionReceipt,
} from '../storage/sqlite/index.js';

function receiptStatus(outcome: ExecutionReceipt): OutcomeReceiptStatus {
  if (outcome.status === 'running') return 'running';
  if (outcome.status === 'cancelled') return 'cancelled';
  if (outcome.needsUser) return 'needs_user';
  if (outcome.completionVerdict === 'achieved') return 'completed';
  if (outcome.completionVerdict === 'partial') return 'partial';
  return 'failed';
}

function remainingWork(outcome: ExecutionReceipt): string[] {
  const incomplete = outcome.verification.checks
    .filter((check) => check.status !== 'passed')
    .map((check) => check.criterion);
  if (outcome.nextAction && !incomplete.includes(outcome.nextAction)) incomplete.push(outcome.nextAction);
  return incomplete;
}

export function toOutcomeReceipt(outcome: ExecutionReceipt): OutcomeReceipt {
  return {
    runId: outcome.runId,
    ...(outcome.context.outcomeId ? { outcomeId: outcome.context.outcomeId } : {}),
    ...(outcome.contractVersion ? { contractVersion: outcome.contractVersion } : {}),
    sessionKey: outcome.sessionKey,
    objective: outcome.objective,
    status: receiptStatus(outcome),
    summary: outcome.summary ?? (outcome.status === 'running' ? 'Work is in progress.' : 'Work finished without a summary.'),
    projectId: outcome.context.projectId,
    goalId: outcome.context.goalId,
    workItemId: outcome.context.workItemId,
    origin: outcome.context.origin,
    triggerKind: outcome.context.triggerKind,
    changes: outcome.evidence.filter((item) => item.kind === 'artifact' || item.kind === 'state'),
    evidence: outcome.evidence,
    verification: outcome.verification,
    remainingWork: remainingWork(outcome),
    nextAction: outcome.nextAction,
    needsUser: outcome.needsUser,
    completionVerdict: outcome.completionVerdict,
    correctionText: outcome.correctionText,
    contextTraceId: outcome.context.contextTraceId,
    startedAt: outcome.startedAt,
    completedAt: outcome.completedAt,
    feedback: outcome.feedback,
  };
}

export class OutcomeReceiptService {
  get(runId: string): OutcomeReceipt | undefined {
    const outcome = getExecutionReceipt(runId);
    return outcome ? toOutcomeReceipt(outcome) : undefined;
  }

  list(input: {
    outcomeId?: string;
    projectId?: string;
    workItemId?: string;
    sessionKey?: string;
    limit?: number;
  } = {}): OutcomeReceipt[] {
    return listExecutionReceipts(input).map(toOutcomeReceipt);
  }
}
