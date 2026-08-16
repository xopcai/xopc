import type { OutcomeReceipt, OutcomeReceiptStatus } from '@xopcai/gateway-contract';

import {
  getTaskOutcome,
  listTaskOutcomes,
  type TaskOutcome,
} from '../storage/sqlite/index.js';

function receiptStatus(outcome: TaskOutcome): OutcomeReceiptStatus {
  if (outcome.status === 'running') return 'running';
  if (outcome.status === 'cancelled') return 'cancelled';
  if (outcome.needsUser) return 'needs_user';
  if (outcome.completionVerdict === 'achieved') return 'completed';
  if (outcome.completionVerdict === 'partial') return 'partial';
  return 'failed';
}

function remainingWork(outcome: TaskOutcome): string[] {
  const incomplete = outcome.verification.checks
    .filter((check) => check.status !== 'passed')
    .map((check) => check.criterion);
  if (outcome.nextAction && !incomplete.includes(outcome.nextAction)) incomplete.push(outcome.nextAction);
  return incomplete;
}

export function toOutcomeReceipt(outcome: TaskOutcome): OutcomeReceipt {
  return {
    runId: outcome.runId,
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
    const outcome = getTaskOutcome(runId);
    return outcome ? toOutcomeReceipt(outcome) : undefined;
  }

  list(input: { projectId?: string; workItemId?: string; sessionKey?: string; limit?: number } = {}): OutcomeReceipt[] {
    return listTaskOutcomes(input).map(toOutcomeReceipt);
  }
}
