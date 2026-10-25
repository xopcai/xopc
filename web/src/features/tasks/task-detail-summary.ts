import { verifiedTaskCriteria } from '@xopcai/gateway-contract';

import type { TaskDetail } from './home-api';

export type CriterionSummary = {
  text: string;
  status: 'passed' | 'failed' | 'unverified';
  evidence: TaskDetail['receipts'][number]['evidence'];
  review?: TaskDetail['criterionReviews'][number];
  runId?: string;
  verificationStatus?: 'passed' | 'failed' | 'unverified';
  method?: 'tool_verified' | 'model_reviewed' | 'unverified';
  note?: string;
};

export function summarizeTaskCriteria(detail: TaskDetail): CriterionSummary[] {
  const criteria = detail.task.contract?.acceptanceCriteria ?? [];
  const runs = new Map(detail.runs.map((run) => [run.id, run]));
  const receipts = detail.receipts
    .filter((receipt) => runs.get(receipt.runId)?.contractVersion === detail.task.latestContractVersion)
    .sort((a, b) => b.finalizedAt - a.finalizedAt);

  return criteria.map((text, index) => {
    const review = detail.criterionReviews.find((item) => item.criterionIndex === index
      && item.contractVersion === detail.task.latestContractVersion && item.criterionText === text);
    let automatic: CriterionSummary = { text, status: 'unverified', evidence: [] };
    for (const receipt of receipts) {
      const check = receipt.verification.checks.find((item) => item.criterion === text);
      if (!check) continue;
      const evidence = receipt.evidence.filter((item) => check.evidenceTitles.includes(item.title));
      const status = check.status === 'passed' && verifiedTaskCriteria(receipt).has(text)
        ? 'passed'
        : check.status === 'failed' ? 'failed' : 'unverified';
      automatic = { text, status, evidence, runId: receipt.runId, verificationStatus: status, method: check.method, note: check.note };
      break;
    }
    if (review && detail.task.contract?.acceptancePolicy !== 'verified_auto') {
      return { ...automatic, status: review.status, review };
    }
    return detail.task.contract?.acceptancePolicy === 'manual'
      ? { ...automatic, status: 'unverified' }
      : automatic;
  });
}

/** Read the newest receipt for the current task contract, never an older objective. */
export function currentTaskReceipt(detail: TaskDetail) {
  const runIds = new Set(detail.runs.filter((run) => run.contractVersion === detail.task.latestContractVersion).map((run) => run.id));
  return detail.receipts.filter((receipt) => runIds.has(receipt.runId)).sort((a, b) => b.finalizedAt - a.finalizedAt)[0];
}

export function summarizeTaskResult(detail: TaskDetail) {
  const receipt = currentTaskReceipt(detail);
  const criteria = summarizeTaskCriteria(detail);
  return {
    receipt,
    verified: criteria.filter((criterion) => criterion.status === 'passed').length,
    criteria: criteria.length,
    deliverables: detail.context.filter((item) => item.role === 'deliverable').length,
  };
}

export type DetailStatusKey = 'allocating' | 'captured' | 'ready' | 'queued' | 'running' | 'verifying' | 'waiting' | 'blocked' | 'failed' | 'cancelled' | 'needsUser' | 'review' | 'completed' | 'ended' | 'paused';
export function detailStatusKey(detail: TaskDetail): DetailStatusKey {
  if (detail.task.phase === 'closed') return detail.task.resolution === 'done' ? 'completed' : 'ended';
  if (detail.waits.some((wait) => wait.kind === 'paused')) return 'paused';
  if (detail.attention.some((item) => item.kind === 'input_required' || item.kind === 'approval_required')) return 'needsUser';
  if (detail.operationalState !== 'idle') return detail.operationalState;
  if (detail.task.phase === 'backlog') return 'captured';
  if (detail.task.phase === 'ready') return 'ready';
  if (detail.task.phase === 'review') return 'review';
  return 'ready';
}

export function detailStatusTone(status: DetailStatusKey): string {
  if (status === 'failed') return 'bg-danger/10 text-danger';
  if (status === 'needsUser' || status === 'blocked') return 'bg-warning/10 text-warning';
  if (status === 'completed') return 'bg-success-soft text-success';
  if (status === 'running' || status === 'verifying' || status === 'review') return 'bg-accent-soft text-accent-fg';
  return 'bg-surface-hover text-fg-muted';
}
