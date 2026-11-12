import { taskCheckId, verifiedTaskCheckIds, type TaskPresentation } from '@xopcai/gateway-contract';

import type { TaskDetail } from './home-api';

export type CriterionSummary = {
  id: string;
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
  const run = detail.runs.find(item => item.id === detail.acceptanceTarget?.runId
    && item.contractVersion === detail.task.latestContractVersion);
  const receipt = run ? detail.receipts.find(item => item.runId === run.id) : undefined;
  const verified = verifiedTaskCheckIds(receipt);

  return criteria.map((text, index) => {
    const id = taskCheckId(detail.task.id, detail.task.latestContractVersion, index);
    const review = detail.criterionReviews.find((item) => item.checkId === id
      && item.contractVersion === detail.task.latestContractVersion && item.criterionText === text);
    let automatic: CriterionSummary = { id, text, status: 'unverified', evidence: [] };
    if (receipt) {
      const checks = receipt.verification.checks.filter(item => item.checkId === id && item.criterion === text);
      const check = checks.length === 1 ? checks[0] : undefined;
      if (check) {
        const evidence = receipt.evidence.filter((item) => check.evidenceTitles.includes(item.title));
        const status = check.status === 'passed' && verified.has(id)
          ? 'passed'
          : check.status === 'failed' ? 'failed' : 'unverified';
        automatic = { id, text, status, evidence, runId: receipt.runId, verificationStatus: status, method: check.method, note: check.note };
      }
    }
    if (review) {
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

export type DetailStatusKey = TaskPresentation['status'];
export function detailStatusKey(detail: TaskDetail): DetailStatusKey {
  return detail.presentation.status;
}

export function detailStatusTone(status: DetailStatusKey): string {
  if (status === 'failed') return 'bg-danger/10 text-danger';
  if (status === 'needsUser' || status === 'blocked') return 'bg-warning/10 text-warning';
  if (status === 'completed') return 'bg-success-soft text-success';
  if (status === 'running' || status === 'verifying' || status === 'review') return 'bg-accent-soft text-accent-fg';
  return 'bg-surface-hover text-fg-muted';
}
