import { describe, expect, it } from 'vitest';

import type { WorkHomeAttention, WorkHomeDecision } from '@xopcai/gateway-contract';

import { AttentionGovernor } from '../attention-governor.js';

function decision(overrides: Partial<WorkHomeDecision>): WorkHomeDecision {
  return {
    id: 'decision-1',
    kind: 'work_item',
    title: 'Prepare launch',
    reason: 'blocked',
    urgency: 'now',
    href: '/work',
    updatedAt: 100,
    ...overrides,
  };
}

describe('AttentionGovernor', () => {
  it('keeps high-value judgment and authorization, while deduplicating internal models', () => {
    const decisions = [
      decision({
        id: 'low-judgment',
        kind: 'agent_judgment',
        title: 'Low-value observation',
        reason: 'decision_needed',
        judgment: {
          inboxItemId: 'low',
          whyNow: 'Maybe useful',
          impact: 'Small',
          workDone: 'Observed',
          recommendation: 'Review',
          confidence: 0.9,
          valueScore: 0.3,
        },
      }),
      decision({
        id: 'high-judgment',
        kind: 'agent_judgment',
        title: 'Protect the launch date',
        reason: 'decision_needed',
        judgment: {
          inboxItemId: 'high',
          whyNow: 'A dependency changed',
          impact: 'Launch risk',
          workDone: 'Compared the options',
          recommendation: 'Move the dependency',
          confidence: 0.92,
          valueScore: 0.88,
        },
      }),
      decision({ id: 'work', projectId: 'project-1' }),
      decision({ id: 'outcome', kind: 'outcome', projectId: 'project-1', updatedAt: 90 }),
      decision({
        id: 'approval',
        kind: 'connector_approval',
        title: 'Send customer email',
        reason: 'approval_required',
        response: { kind: 'connector_approval', approvalId: 'approval-1' },
      }),
    ];
    const attention: WorkHomeAttention[] = Array.from({ length: 4 }, (_, index) => ({
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
      proactiveEnabled: true,
      maxDecisions: 3,
      maxAttention: 2,
    });

    expect(result.decisions.map((item) => item.id)).toEqual(['approval', 'work', 'high-judgment']);
    expect(result.attention.map((item) => item.id)).toEqual(['attention-3', 'attention-2']);
    expect(result.policy).toEqual({
      visibleDecisionCount: 3,
      suppressedDecisionCount: 2,
      visibleAttentionCount: 2,
      suppressedAttentionCount: 2,
    });
  });

  it('does not interrupt with proactive judgments when proactive support is disabled', () => {
    const result = new AttentionGovernor().project({
      decisions: [decision({
        kind: 'agent_judgment',
        reason: 'decision_needed',
        judgment: {
          inboxItemId: 'judgment',
          whyNow: 'Now',
          impact: 'High',
          workDone: 'Analyzed',
          recommendation: 'Act',
          confidence: 1,
          valueScore: 1,
        },
      })],
      attention: [],
      proactiveEnabled: false,
    });
    expect(result.decisions).toHaveLength(0);
    expect(result.policy.suppressedDecisionCount).toBe(1);
  });
});
