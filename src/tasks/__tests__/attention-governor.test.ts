import { describe, expect, it } from 'vitest';

import type { HomeAttention, HomeDecision } from '@xopcai/gateway-contract';

import { AttentionGovernor } from '../attention-governor.js';

function decision(overrides: Partial<HomeDecision>): HomeDecision {
  return {
    id: 'decision-1',
    kind: 'task',
    title: 'Prepare launch',
    reason: 'blocked',
    urgency: 'now',
    href: '/',
    updatedAt: 100,
    ...overrides,
  };
}

describe('AttentionGovernor', () => {
  it('prioritizes approvals, deduplicates decisions, and caps visible items', () => {
    const decisions = [
      decision({ id: 'work', projectId: 'project-1' }),
      decision({ id: 'task', kind: 'task', projectId: 'project-1', updatedAt: 90 }),
      decision({ id: 'overdue', title: 'Submit review', reason: 'overdue', updatedAt: 80 }),
      decision({
        id: 'approval',
        kind: 'connector_approval',
        title: 'Send customer email',
        reason: 'approval_required',
        response: { kind: 'connector_approval', approvalId: 'approval-1' },
      }),
    ];
    const attention: HomeAttention[] = Array.from({ length: 4 }, (_, index) => ({
      id: `attention-${index}`,
      kind: 'workflow_run',
      runId: `run-${index}`,
      title: `Run ${index}`,
      detail: 'Failed',
      reason: 'run_failed',
      href: '/workflows',
      updatedAt: index,
    }));

    const result = new AttentionGovernor().project({
      decisions,
      attention,
      maxDecisions: 3,
      maxAttention: 2,
    });

    expect(result.decisions.map((item) => item.id)).toEqual(['approval', 'work', 'overdue']);
    expect(result.attention.map((item) => item.id)).toEqual(['attention-3', 'attention-2']);
    expect(result.policy).toEqual({
      visibleDecisionCount: 3,
      suppressedDecisionCount: 1,
      visibleAttentionCount: 2,
      suppressedAttentionCount: 2,
    });
  });

});
