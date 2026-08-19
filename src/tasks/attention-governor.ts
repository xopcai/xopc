import type { HomeAttention, HomeDecision } from '@xopcai/gateway-contract';

export interface AttentionProjection {
  decisions: HomeDecision[];
  attention: HomeAttention[];
  policy: {
    visibleDecisionCount: number;
    suppressedDecisionCount: number;
    visibleAttentionCount: number;
    suppressedAttentionCount: number;
  };
}

function decisionScore(item: HomeDecision): number {
  if (item.reason === 'approval_required') return 100;
  if (item.reason === 'needs_input' || item.reason === 'user_input' || item.reason === 'user_approval') return 95;
  if (item.reason === 'blocked' || item.reason === 'dependency' || item.reason === 'external') return 85;
  if (item.kind === 'agent_judgment') return Math.round((item.judgment?.valueScore ?? 0) * 70) + (item.urgency === 'now' ? 20 : 0);
  if (item.reason === 'overdue') return 70;
  return 50;
}

function decisionKey(item: HomeDecision): string {
  const title = item.title.trim().toLocaleLowerCase();
  return item.response
    ? item.id
    : `${item.projectId ?? 'global'}:${title}:${item.reason === 'approval_required' ? item.id : ''}`;
}

function keepDecision(item: HomeDecision, proactiveEnabled: boolean): boolean {
  if (item.kind !== 'agent_judgment') return true;
  if (!proactiveEnabled) return false;
  return (item.judgment?.confidence ?? 0) >= 0.65
    && (item.judgment?.valueScore ?? 0) >= 0.6;
}

export class AttentionGovernor {
  project(input: {
    decisions: HomeDecision[];
    attention: HomeAttention[];
    proactiveEnabled: boolean;
    maxDecisions?: number;
    maxAttention?: number;
  }): AttentionProjection {
    const maxDecisions = Math.max(1, Math.min(20, input.maxDecisions ?? 7));
    const maxAttention = Math.max(1, Math.min(10, input.maxAttention ?? 5));
    const seen = new Set<string>();
    const eligible = [...input.decisions]
      .filter((item) => keepDecision(item, input.proactiveEnabled))
      .sort((left, right) => decisionScore(right) - decisionScore(left) || right.updatedAt - left.updatedAt)
      .filter((item) => {
        const key = decisionKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const attention = [...input.attention]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, maxAttention);
    const decisions = eligible.slice(0, maxDecisions);
    return {
      decisions,
      attention,
      policy: {
        visibleDecisionCount: decisions.length,
        suppressedDecisionCount: Math.max(0, input.decisions.length - decisions.length),
        visibleAttentionCount: attention.length,
        suppressedAttentionCount: Math.max(0, input.attention.length - attention.length),
      },
    };
  }
}
