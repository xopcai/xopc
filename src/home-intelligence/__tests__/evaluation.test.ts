import { describe, expect, it } from 'vitest';

import type { HomeCapabilityRequirement, HomeCapabilityResolution } from '../capability-preflight.js';
import { evaluateHomeAdviceReplay, type HomeAdviceReplayCase } from '../evaluation.js';
import type { HomeModelCandidate } from '../generator.js';
import type { HomeContextSnapshot } from '../snapshot.js';

const now = 10_000;
const projectEvidence = {
  id: 'project:atlas:1', sourceType: 'project' as const, sourceRef: 'atlas', revision: '1',
  observation: 'Atlas is preparing a release.', observedAt: now, freshUntil: now + 60_000,
};
const calendarEvidence = {
  id: 'calendar:review:1', sourceType: 'calendar' as const, sourceRef: 'review', revision: '1',
  observation: 'Review meeting is tomorrow.', observedAt: now, freshUntil: now + 60_000,
};
const mailEvidence = {
  id: 'mail:follow-up:1', sourceType: 'mail' as const, sourceRef: 'follow-up', revision: '1',
  observation: 'A follow-up was promised.', observedAt: now, freshUntil: now + 60_000,
};

function snapshot(overrides: Partial<HomeContextSnapshot> = {}): HomeContextSnapshot {
  return {
    generatedAt: now, locale: 'en',
    projects: [{ id: 'atlas', name: 'Atlas', status: 'active', health: 'on_track', successCriteria: [], updatedAt: now }],
    tasks: [], knowledge: [], recentSessions: [], successfulPatterns: [],
    evidence: [projectEvidence, calendarEvidence, mailEvidence], hash: 'fixture',
    ...overrides,
  };
}

function candidate(overrides: Partial<HomeModelCandidate> = {}): HomeModelCandidate {
  return {
    kind: 'project_next_step', projectId: 'atlas', title: 'Prepare release checklist',
    outcome: 'A reviewed release checklist.', rationale: 'The release is approaching.',
    evidenceIds: [projectEvidence.id], confidence: 'high', urgency: 'today', risk: 'analysis',
    proposedSteps: ['Review open work'], requiredCapabilities: [], verification: ['Checklist is complete'],
    actionPrompt: 'Prepare the Atlas release checklist.', ...overrides,
  };
}

function resolveCapabilities(requirements: readonly HomeCapabilityRequirement[]): HomeCapabilityResolution {
  const capabilities = requirements.map((item) => item.kind === 'connector'
    ? { ...item, readiness: 'needs_setup' as const, recoveryPath: '/connectors', reason: 'Not connected' }
    : { ...item, readiness: 'ready' as const, resolvedId: 'main' });
  const blockers = capabilities.filter((item) => item.required && item.readiness !== 'ready').map((item) => ({
    kind: item.kind, capability: item.capability, code: 'connection_missing' as const,
    message: item.reason ?? 'Not ready', recoveryPath: item.recoveryPath ?? '/settings',
  }));
  return blockers.length > 0
    ? { capabilities, preflight: { state: 'needs_setup', blockers, recoveryActions: blockers.map((item) => ({ capability: item.capability, href: item.recoveryPath })) } }
    : { capabilities, preflight: { state: 'ready' } };
}

describe('home advice offline replay', () => {
  it('passes twelve deterministic scenario fixtures through the production policy', () => {
    const fixtures: HomeAdviceReplayCase[] = [
      { id: 'project-next-step', snapshot: snapshot(), model: { state: 'ready', candidates: [candidate()] }, expected: { state: 'ready', acceptedKinds: ['project_next_step'] } },
      { id: 'low-confidence', snapshot: snapshot(), model: { state: 'ready', candidates: [candidate({ confidence: 'low' })] }, expected: { state: 'quiet' } },
      { id: 'unknown-evidence', snapshot: snapshot(), model: { state: 'ready', candidates: [candidate({ evidenceIds: ['unknown'] })] }, expected: { state: 'quiet' } },
      { id: 'unknown-project', snapshot: snapshot(), model: { state: 'ready', candidates: [candidate({ projectId: 'unknown' })] }, expected: { state: 'quiet' } },
      { id: 'duplicate-task', snapshot: snapshot({ tasks: [{ id: 'task-1', projectId: 'atlas', title: 'Prepare release checklist', phase: 'ready', priority: 'normal', updatedAt: now }] }), model: { state: 'ready', candidates: [candidate()] }, expected: { state: 'quiet' } },
      { id: 'meeting-without-calendar', snapshot: snapshot(), model: { state: 'ready', candidates: [candidate({ kind: 'meeting_prep' })] }, expected: { state: 'quiet' } },
      { id: 'meeting-with-calendar', snapshot: snapshot(), model: { state: 'ready', candidates: [candidate({ kind: 'meeting_prep', evidenceIds: [calendarEvidence.id] })] }, expected: { state: 'ready', acceptedKinds: ['meeting_prep'] } },
      { id: 'commitment-with-mail', snapshot: snapshot(), model: { state: 'ready', candidates: [candidate({ kind: 'commitment_follow_up', evidenceIds: [mailEvidence.id] })] }, expected: { state: 'ready', acceptedKinds: ['commitment_follow_up'] } },
      { id: 'missing-connector', snapshot: snapshot(), model: { state: 'ready', candidates: [candidate({ requiredCapabilities: [{ kind: 'connector', capability: 'calendar.read', required: true }] })] }, expected: { state: 'ready', acceptedKinds: ['project_next_step'] } },
      { id: 'explicit-suppression', snapshot: snapshot(), model: { state: 'ready', candidates: [candidate()] }, suppressedKeys: new Set(['project_next_step:atlas']), expected: { state: 'quiet' } },
      { id: 'personalized-threshold', snapshot: snapshot(), model: { state: 'ready', candidates: [candidate({ confidence: 'medium' })] }, personalization: { highConfidenceKinds: new Set(['project_next_step']) }, expected: { state: 'quiet' } },
      { id: 'external-write-confirmation', snapshot: snapshot(), model: { state: 'ready', candidates: [candidate({ risk: 'external_write' })] }, expected: { state: 'ready', acceptedKinds: ['project_next_step'] } },
    ];

    expect(evaluateHomeAdviceReplay(fixtures, resolveCapabilities)).toEqual({
      total: 12,
      passed: 12,
      failures: [],
      hardGates: {
        expectedOutcomesMatch: true,
        evidenceReferencesValid: true,
        capabilityClaimsValid: true,
        externalWritesRequireConfirmation: true,
      },
    });
  });
});
