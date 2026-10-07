import { describe, expect, it } from 'vitest';

import type { TaskDetail } from './home-api';
import { summarizeTaskCriteria } from './task-detail-summary';

function detail(): TaskDetail {
  return {
    task: { latestContractVersion: 2, contract: { acceptanceCriteria: ['Tests pass'], acceptancePolicy: 'verified_then_review' } },
    runs: [{ id: 'old', contractVersion: 1 }, { id: 'current', contractVersion: 2 }],
    receipts: [
      { runId: 'old', finalizedAt: 200, verification: { checks: [{ criterion: 'Tests pass', status: 'passed', evidenceTitles: ['Old test'] }] }, evidence: [{ title: 'Old test', strength: 'verified' }] },
      { runId: 'current', finalizedAt: 100, verification: { checks: [{ criterion: 'Tests pass', status: 'passed', evidenceTitles: ['Current test'] }] }, evidence: [{ title: 'Current test', strength: 'verified' }] },
    ],
    criterionReviews: [],
  } as unknown as TaskDetail;
}

describe('summarizeTaskCriteria', () => {
  it('uses verified evidence from the current contract version', () => {
    expect(summarizeTaskCriteria(detail())[0]).toMatchObject({ status: 'passed', runId: 'current' });
  });

  it('lets the current human review decide a criterion', () => {
    const task = detail();
    task.criterionReviews = [{ contractVersion: 2, criterionIndex: 0, criterionText: 'Tests pass',
      status: 'failed', reviewedBy: { kind: 'user' }, reviewedAt: 300 }];
    expect(summarizeTaskCriteria(task)[0]).toMatchObject({ status: 'failed', review: { reviewedAt: 300 } });
  });

  it('does not count execution evidence as approval for a manual criterion', () => {
    const task = detail();
    task.task.contract!.acceptancePolicy = 'manual';
    expect(summarizeTaskCriteria(task)[0]).toMatchObject({ status: 'unverified', runId: 'current' });
  });
});
