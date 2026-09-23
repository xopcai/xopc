import { randomUUID } from 'node:crypto';

import type { HomeOpportunity } from '@xopcai/gateway-contract';

import type { HomeModelCandidate, HomeModelResult } from './generator.js';
import type { HomeCapabilityRequirement, HomeCapabilityResolution } from './capability-preflight.js';
import type { HomeGeneratedResult } from './types.js';
import type { HomeContextSnapshot } from './snapshot.js';
import { homePatternKey, type HomeAdvicePersonalization } from './strategy.js';

const CONFIDENCE_SCORE = { high: 30, medium: 20, low: 0 } as const;
const URGENCY_SCORE = { now: 12, today: 8, this_week: 4 } as const;
const RISK_PENALTY = { analysis: 0, external_read: 1, file_write: 4, external_write: 10 } as const;

function expiryFor(urgency: HomeOpportunity['urgency'], now: number): number {
  if (urgency === 'now') return now + 6 * 60 * 60_000;
  if (urgency === 'today') return now + 24 * 60 * 60_000;
  return now + 3 * 24 * 60 * 60_000;
}

function normalized(value: string | undefined): string {
  return (value ?? '').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}

function hasRequiredScenarioEvidence(
  kind: HomeOpportunity['kind'],
  evidence: readonly HomeOpportunity['evidence'][number][],
): boolean {
  if (kind === 'meeting_prep') return evidence.some((item) => item.sourceType === 'calendar');
  if (kind === 'commitment_follow_up') {
    return evidence.some((item) => item.sourceType === 'mail' || item.sourceType === 'communication');
  }
  return true;
}

export class HomeAdvicePolicy {
  constructor(
    private readonly resolveCapabilities: (
      requirements: readonly HomeCapabilityRequirement[],
      options?: { degradedActionAvailable?: boolean },
    ) => HomeCapabilityResolution,
    private readonly suppressedKeys: ReadonlySet<string> = new Set(),
    private readonly successfulCounts: ReadonlyMap<string, number> = new Map(),
    private readonly personalization: HomeAdvicePersonalization = { highConfidenceKinds: new Set() },
  ) {}

  apply(snapshot: HomeContextSnapshot, model: HomeModelResult, now: number): HomeGeneratedResult {
    const evidenceById = new Map(snapshot.evidence.map((item) => [item.id, item]));
    if (model.state === 'quiet') return model;
    if (model.state === 'clarification') {
      const evidenceIds = [...new Set(model.evidenceIds)]
        .filter((id) => (evidenceById.get(id)?.freshUntil ?? 0) > now);
      const options = [...new Map(model.options.map((option) => [option.id, option])).values()];
      if (evidenceIds.length < 2 || options.length < 2) return { state: 'quiet', reason: 'insufficient_value' };
      return {
        state: 'clarification',
        question: { id: randomUUID(), revision: 1, question: model.question, options, evidenceIds },
        generatedAt: now,
        expiresAt: now + 24 * 60 * 60_000,
      };
    }

    const projectIds = new Set(snapshot.projects.map((project) => project.id));
    const scored = model.candidates.flatMap((candidate) => {
      if (candidate.confidence === 'low' || (candidate.projectId && !projectIds.has(candidate.projectId))) return [];
      if (candidate.confidence !== 'high' && this.personalization.highConfidenceKinds.has(candidate.kind)) return [];
      if (this.suppressedKeys.has(`${candidate.kind}:${candidate.projectId ?? 'global'}`)) return [];
      const duplicateTask = snapshot.tasks.some((task) => task.projectId === candidate.projectId
        && (normalized(task.title) === normalized(candidate.title)
          || (task.objective && normalized(task.objective) === normalized(candidate.outcome))));
      if (duplicateTask) return [];
      const evidence = [...new Set(candidate.evidenceIds)]
        .map((id) => evidenceById.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item && item.freshUntil > now));
      if (!evidence.length || !hasRequiredScenarioEvidence(candidate.kind, evidence)) return [];
      const resolution = this.resolveCapabilities(candidate.requiredCapabilities, {
        degradedActionAvailable: Boolean(candidate.degradedActionPrompt),
      });
      const capabilities = resolution.capabilities;
      const missingRequired = capabilities.some((item) => item.required && item.readiness !== 'ready');
      const canStart = !missingRequired && candidate.risk !== 'external_write';
      const degradedStartAvailable = missingRequired
        && Boolean(candidate.degradedActionPrompt)
        && candidate.risk !== 'external_write';
      const opportunity: HomeOpportunity = {
        id: randomUUID(),
        revision: 1,
        kind: candidate.kind,
        projectId: candidate.projectId,
        title: candidate.title,
        outcome: candidate.outcome,
        rationale: candidate.rationale,
        evidence,
        confidence: candidate.confidence,
        urgency: candidate.urgency,
        estimatedMinutes: candidate.estimatedMinutes,
        risk: candidate.risk,
        proposedSteps: candidate.proposedSteps,
        capabilities,
        verification: candidate.verification,
        actionPrompt: candidate.actionPrompt,
        degradedActionPrompt: candidate.degradedActionPrompt,
        ...this.continuation(candidate, snapshot.locale),
        actions: {
          canStart,
          canDiscuss: true,
          degradedStartAvailable,
        },
        generatedAt: now,
        expiresAt: expiryFor(candidate.urgency, now),
      };
      const score = CONFIDENCE_SCORE[candidate.confidence] + URGENCY_SCORE[candidate.urgency]
        - RISK_PENALTY[candidate.risk] - (missingRequired ? 12 : 0) + Math.min(evidence.length, 3);
      return [{ opportunity, score }];
    });

    const seen = new Set<string>();
    const ranked = scored
      .sort((left, right) => right.score - left.score || left.opportunity.title.localeCompare(right.opportunity.title))
      .filter(({ opportunity }) => {
        const key = `${opportunity.kind}:${opportunity.projectId ?? 'global'}:${normalized(opportunity.outcome)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3);
    if (!ranked.length) return { state: 'quiet', reason: 'insufficient_value' };
    const primary = ranked[0]!;
    return {
      state: 'ready',
      opportunities: ranked.map((item) => item.opportunity),
      placement: primary.score >= 38 && primary.opportunity.actions.canStart ? 'primary' : 'compact',
    };
  }

  private continuation(
    candidate: HomeModelCandidate,
    locale: HomeContextSnapshot['locale'],
  ): Pick<HomeOpportunity, 'continuation'> | Record<string, never> {
    if (candidate.kind !== 'automation_candidate') return {};
    const successCount = this.successfulCounts.get(homePatternKey(candidate.projectId, candidate.outcome)) ?? 0;
    if (successCount >= 2) {
      const outcome = candidate.outcome.slice(0, 140);
      const approach = candidate.actionPrompt.slice(0, 140);
      const prompt = locale === 'zh'
        ? `把这项已经稳定成功的工作设计成可复核的 Automation 草稿：${outcome}\n执行方式：${approach}\n请先确认触发条件、频率、范围和外部动作边界，不要直接发布。`
        : `Design a reviewable Automation draft for this repeatedly successful work: ${outcome}\nExecution approach: ${approach}\nFirst confirm the trigger, schedule, scope, and external-action boundaries. Do not publish it automatically.`;
      const params = new URLSearchParams({
        draft: prompt,
        autogenerate: '1',
      });
      if (candidate.projectId) params.set('projectId', candidate.projectId);
      return {
        continuation: {
          kind: 'automation',
          reason: 'repeated_success',
          href: `/automations?${params.toString()}`,
          successCount,
        },
      };
    }
    if (successCount === 1) {
      return {
        continuation: {
          kind: 'scene',
          reason: 'prior_success',
          href: '/scenes',
        },
      };
    }
    return {};
  }
}
