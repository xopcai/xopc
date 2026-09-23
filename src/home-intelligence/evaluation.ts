import type { HomeOpportunity } from '@xopcai/gateway-contract';

import type { HomeCapabilityRequirement, HomeCapabilityResolution } from './capability-preflight.js';
import type { HomeModelResult } from './generator.js';
import { HomeAdvicePolicy } from './policy.js';
import type { HomeContextSnapshot } from './snapshot.js';
import type { HomeAdvicePersonalization } from './strategy.js';

export interface HomeAdviceReplayCase {
  id: string;
  snapshot: HomeContextSnapshot;
  model: HomeModelResult;
  expected: {
    state: 'quiet' | 'clarification' | 'ready';
    acceptedKinds?: HomeOpportunity['kind'][];
  };
  suppressedKeys?: ReadonlySet<string>;
  successfulCounts?: ReadonlyMap<string, number>;
  personalization?: HomeAdvicePersonalization;
}

export interface HomeAdviceReplayReport {
  total: number;
  passed: number;
  failures: Array<{ id: string; reasons: string[] }>;
  hardGates: {
    expectedOutcomesMatch: boolean;
    evidenceReferencesValid: boolean;
    capabilityClaimsValid: boolean;
    externalWritesRequireConfirmation: boolean;
  };
}

export function evaluateHomeAdviceReplay(
  cases: readonly HomeAdviceReplayCase[],
  resolveCapabilities: (
    requirements: readonly HomeCapabilityRequirement[],
    options?: { degradedActionAvailable?: boolean },
  ) => HomeCapabilityResolution,
): HomeAdviceReplayReport {
  let evidenceReferencesValid = true;
  let capabilityClaimsValid = true;
  let externalWritesRequireConfirmation = true;
  const failures: HomeAdviceReplayReport['failures'] = [];

  for (const fixture of cases) {
    const result = new HomeAdvicePolicy(
      resolveCapabilities,
      fixture.suppressedKeys,
      fixture.successfulCounts,
      fixture.personalization,
    ).apply(fixture.snapshot, fixture.model, fixture.snapshot.generatedAt);
    const reasons: string[] = [];
    if (result.state !== fixture.expected.state) {
      reasons.push(`expected state ${fixture.expected.state}, received ${result.state}`);
    }
    if (result.state === 'ready') {
      const acceptedKinds = result.opportunities.map((item) => item.kind);
      if (fixture.expected.acceptedKinds
        && JSON.stringify(acceptedKinds) !== JSON.stringify(fixture.expected.acceptedKinds)) {
        reasons.push(`expected kinds ${fixture.expected.acceptedKinds.join(',')}, received ${acceptedKinds.join(',')}`);
      }
      const evidenceIds = new Set(fixture.snapshot.evidence.map((item) => item.id));
      for (const opportunity of result.opportunities) {
        if (opportunity.evidence.some((item) => !evidenceIds.has(item.id) || item.freshUntil <= fixture.snapshot.generatedAt)) {
          evidenceReferencesValid = false;
          reasons.push('accepted opportunity contains unknown or expired evidence');
        }
        if (opportunity.capabilities.some((item) => item.readiness === 'ready' && !item.resolvedId)) {
          capabilityClaimsValid = false;
          reasons.push('ready capability has no resolved id');
        }
        if (opportunity.risk === 'external_write' && opportunity.actions.canStart) {
          externalWritesRequireConfirmation = false;
          reasons.push('external write can start without confirmation');
        }
      }
    }
    if (reasons.length > 0) failures.push({ id: fixture.id, reasons });
  }

  return {
    total: cases.length,
    passed: cases.length - failures.length,
    failures,
    hardGates: {
      expectedOutcomesMatch: failures.every((failure) => failure.reasons.every((reason) =>
        !reason.startsWith('expected state') && !reason.startsWith('expected kinds'))),
      evidenceReferencesValid,
      capabilityClaimsValid,
      externalWritesRequireConfirmation,
    },
  };
}

