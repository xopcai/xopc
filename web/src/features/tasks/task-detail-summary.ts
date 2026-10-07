import { verifiedTaskCriteria } from '@xopcai/gateway-contract';

import type { TaskDetail } from './home-api';

export type CriterionSummary = {
  text: string;
  status: 'passed' | 'failed' | 'unverified';
  evidence: TaskDetail['receipts'][number]['evidence'];
  review?: TaskDetail['criterionReviews'][number];
  runId?: string;
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
      if (!check || check.status === 'unverified') continue;
      const evidence = receipt.evidence.filter((item) => check.evidenceTitles.includes(item.title));
      const status = check.status === 'passed' && verifiedTaskCriteria(receipt).has(text)
        ? 'passed'
        : check.status === 'failed' ? 'failed' : 'unverified';
      if (status !== 'unverified') {
        automatic = { text, status, evidence, runId: receipt.runId };
        break;
      }
    }
    if (review && detail.task.contract?.acceptancePolicy !== 'verified_auto') {
      return { ...automatic, status: review.status, review };
    }
    return detail.task.contract?.acceptancePolicy === 'manual'
      ? { ...automatic, status: 'unverified' }
      : automatic;
  });
}
