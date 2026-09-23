import { describe, expect, it } from 'vitest';

import type { HomeCapabilityRequirement, HomeCapabilityResolution } from '../capability-preflight.js';
import type { HomeContextSnapshot } from '../snapshot.js';
import { homePatternKey } from '../strategy.js';
import { HomeAdvicePolicy } from '../policy.js';

const now = 1_000;
const evidence = {
  id: 'project:atlas:v1', sourceType: 'project' as const, sourceRef: 'atlas', revision: '1',
  observation: 'Atlas 本周需要发布。', observedAt: now, freshUntil: now + 60_000,
};
const taskEvidence = {
  id: 'task:release:v1', sourceType: 'task' as const, sourceRef: 'release', revision: '1',
  observation: '发布清单仍未完成。', observedAt: now, freshUntil: now + 60_000,
};
const calendarEvidence = {
  id: 'knowledge:calendar:v1', sourceType: 'calendar' as const, sourceRef: 'calendar', revision: '1',
  observation: 'Atlas review starts tomorrow at 10:00.', observedAt: now, freshUntil: now + 60_000,
};
const mailEvidence = {
  id: 'knowledge:mail:v1', sourceType: 'mail' as const, sourceRef: 'mail', revision: '1',
  observation: 'A launch follow-up was promised for today.', observedAt: now, freshUntil: now + 60_000,
};
const snapshot: HomeContextSnapshot = {
  generatedAt: now,
  locale: 'zh',
  projects: [{
    id: 'atlas', name: 'Atlas', status: 'active', health: 'at_risk', successCriteria: [], updatedAt: now,
  }],
  tasks: [], knowledge: [], recentSessions: [], successfulPatterns: [],
  evidence: [evidence, taskEvidence, calendarEvidence, mailEvidence], hash: 'snapshot',
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'delivery_risk' as const,
    projectId: 'atlas',
    title: '检查发布阻塞项',
    outcome: '确认本周发布是否可行。',
    rationale: '项目处于风险状态。',
    evidenceIds: [evidence.id],
    confidence: 'high' as const,
    urgency: 'today' as const,
    risk: 'analysis' as const,
    proposedSteps: ['检查未完成事项'],
    requiredCapabilities: [{ kind: 'agent' as const, capability: 'reasoning', required: true }],
    verification: ['列出阻塞项及证据'],
    actionPrompt: '检查 Atlas 的发布阻塞项，只使用已有项目证据。',
    ...overrides,
  };
}

function resolveCapabilities(
  requirements: readonly HomeCapabilityRequirement[],
  options: { degradedActionAvailable?: boolean } = {},
): HomeCapabilityResolution {
  const capabilities = requirements.map((requirement) => requirement.kind === 'agent'
    ? { ...requirement, resolvedId: 'main', readiness: 'ready' as const }
    : {
        ...requirement,
        readiness: 'needs_setup' as const,
        recoveryPath: requirement.kind === 'connector' ? '/connectors' : '/skills',
        reason: `${requirement.capability} is not ready`,
      });
  const blockers = capabilities.filter((item) => item.required && item.readiness !== 'ready').map((item) => ({
    kind: item.kind,
    capability: item.capability,
    code: 'not_installed' as const,
    message: item.reason!,
    recoveryPath: item.recoveryPath!,
  }));
  return blockers.length
    ? {
        capabilities,
        preflight: {
          state: 'needs_setup',
          blockers,
          recoveryActions: blockers.map((item) => ({ capability: item.capability, href: item.recoveryPath })),
          ...(options.degradedActionAvailable ? { degradedAction: { mode: 'degraded_start' as const } } : {}),
        },
      }
    : { capabilities, preflight: { state: 'ready' } };
}

describe('HomeAdvicePolicy', () => {
  const policy = new HomeAdvicePolicy(resolveCapabilities);

  it('ranks grounded, executable outcomes ahead of risky suggestions', () => {
    const result = policy.apply(snapshot, {
      state: 'ready',
      candidates: [
        candidate({
          title: '直接通知客户', outcome: '客户收到发布风险通知。',
          risk: 'external_write', urgency: 'now',
        }),
        candidate(),
      ],
    }, now);
    expect(result).toMatchObject({
      state: 'ready',
      placement: 'primary',
      opportunities: [
        { title: '检查发布阻塞项', actions: { canStart: true, canDiscuss: true } },
        { title: '直接通知客户', actions: { canStart: false, canDiscuss: true } },
      ],
    });
  });

  it('rejects hallucinated evidence and unknown projects', () => {
    expect(policy.apply(snapshot, {
      state: 'ready',
      candidates: [
        candidate({ evidenceIds: ['missing'] }),
        candidate({ projectId: 'invented' }),
      ],
    }, now)).toEqual({ state: 'quiet', reason: 'insufficient_value' });
  });

  it('turns missing capabilities into setup guidance instead of pretending readiness', () => {
    const result = policy.apply(snapshot, {
      state: 'ready',
      candidates: [candidate({
        requiredCapabilities: [{ kind: 'connector', capability: 'google-calendar', required: true }],
      })],
    }, now);
    expect(result).toMatchObject({
      state: 'ready', placement: 'compact',
      opportunities: [{
        actions: { canStart: false },
        capabilities: [{ readiness: 'needs_setup', recoveryPath: '/connectors' }],
      }],
    });
  });

  it('offers degraded start only when the model supplies a grounded fallback prompt', () => {
    const result = policy.apply(snapshot, {
      state: 'ready',
      candidates: [candidate({
        requiredCapabilities: [{ kind: 'connector', capability: 'google-calendar', required: true }],
        degradedActionPrompt: '仅使用已有项目证据整理待确认的会议准备清单。',
      })],
    }, now);
    expect(result).toMatchObject({
      state: 'ready',
      opportunities: [{
        degradedActionPrompt: '仅使用已有项目证据整理待确认的会议准备清单。',
        actions: { canStart: false, degradedStartAvailable: true },
      }],
    });
  });

  it('requires source-specific evidence for cross-source moments', () => {
    expect(policy.apply(snapshot, {
      state: 'ready',
      candidates: [candidate({ kind: 'meeting_prep', evidenceIds: [evidence.id] })],
    }, now)).toEqual({ state: 'quiet', reason: 'insufficient_value' });

    expect(policy.apply(snapshot, {
      state: 'ready',
      candidates: [
        candidate({ kind: 'meeting_prep', evidenceIds: [calendarEvidence.id] }),
        candidate({ kind: 'commitment_follow_up', evidenceIds: [mailEvidence.id] }),
      ],
    }, now)).toMatchObject({
      state: 'ready',
      opportunities: [{ kind: 'meeting_prep' }, { kind: 'commitment_follow_up' }],
    });
  });

  it('keeps clarification grounded in known evidence', () => {
    expect(policy.apply(snapshot, {
      state: 'clarification',
      question: '你更希望先降低发布风险，还是先准备公告？',
      options: [{ id: 'risk', label: '降低风险' }, { id: 'announce', label: '准备公告' }],
      evidenceIds: [evidence.id, taskEvidence.id, 'invented'],
    }, now)).toMatchObject({
      state: 'clarification',
      question: { evidenceIds: [evidence.id, taskEvidence.id] },
    });
  });

  it('honors durable less-like-this feedback before ranking', () => {
    const suppressed = new HomeAdvicePolicy(
      resolveCapabilities,
      new Set(['delivery_risk:atlas']),
    );
    expect(suppressed.apply(snapshot, { state: 'ready', candidates: [candidate()] }, now))
      .toEqual({ state: 'quiet', reason: 'insufficient_value' });
  });

  it('does not recommend work already represented by an active task', () => {
    const withTask: HomeContextSnapshot = {
      ...snapshot,
      tasks: [{
        id: 'task-1', projectId: 'atlas', title: '检查发布阻塞项', phase: 'ready', priority: 'high',
        updatedAt: now, objective: '确认本周发布是否可行。',
      }],
    };
    expect(policy.apply(withTask, { state: 'ready', candidates: [candidate()] }, now))
      .toEqual({ state: 'quiet', reason: 'insufficient_value' });
  });

  it('suggests a Scene only after the same automation pattern previously succeeded', () => {
    const experienced = new HomeAdvicePolicy(
      resolveCapabilities,
      new Set(),
      new Map([[homePatternKey('atlas', '确认本周发布是否可行。'), 1]]),
    );
    const result = experienced.apply(snapshot, {
      state: 'ready',
      candidates: [candidate({ kind: 'automation_candidate' })],
    }, now);
    expect(result).toMatchObject({
      state: 'ready',
      opportunities: [{ continuation: { kind: 'scene', reason: 'prior_success', href: '/scenes' } }],
    });
  });

  it('offers an Automation draft only after the same pattern succeeded twice', () => {
    const experienced = new HomeAdvicePolicy(
      resolveCapabilities,
      new Set(),
      new Map([[homePatternKey('atlas', '确认本周发布是否可行。'), 2]]),
    );
    const result = experienced.apply(snapshot, {
      state: 'ready',
      candidates: [candidate({ kind: 'automation_candidate' })],
    }, now);
    expect(result).toMatchObject({
      state: 'ready',
      opportunities: [{
        continuation: {
          kind: 'automation', reason: 'repeated_success', successCount: 2,
        },
      }],
    });
    if (result.state !== 'ready') throw new Error('Expected ready advice');
    const href = result.opportunities[0]?.continuation?.href ?? '';
    expect(href).toContain('/automations?');
    expect(href).toContain('autogenerate=1');
    expect(decodeURIComponent(href)).toContain('不要直接发布');
  });

  it('raises the confidence threshold only from repeated explicit negative feedback', () => {
    const personalized = new HomeAdvicePolicy(
      resolveCapabilities,
      new Set(),
      new Map(),
      { highConfidenceKinds: new Set(['delivery_risk']) },
    );
    expect(personalized.apply(snapshot, {
      state: 'ready', candidates: [candidate({ confidence: 'medium' })],
    }, now)).toEqual({ state: 'quiet', reason: 'insufficient_value' });
    expect(personalized.apply(snapshot, {
      state: 'ready', candidates: [candidate({ confidence: 'high' })],
    }, now)).toMatchObject({ state: 'ready' });
  });
});
