import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  listCollaborationRules,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { getUserAssertion } from '../../repository.js';
import { listUserGoals } from '../../goals.js';
import { executeUserModelInterpretation } from '../executor.js';
import type { CaptureEvidence, UserModelInterpretation } from '../semantic.js';

const source: CaptureEvidence = {
  ref: 'message-1',
  role: 'user',
  text: 'Remember that I prefer concise answers.',
  createdAt: 1_000,
};

function interpretation(overrides: Partial<UserModelInterpretation> = {}): UserModelInterpretation {
  return {
    intent: 'remember',
    targetAssertionIds: [],
    candidates: [{
      subject: { type: 'user', id: 'self' },
      predicate: 'preference.response.detail',
      cardinality: 'single',
      scope: { type: 'project', id: 'project-1' },
      kind: 'preference',
      value: 'concise',
      normalizedValue: 'concise',
      statement: 'The user prefers concise answers.',
      authority: 'user_explicit',
      confidence: 1,
      inferredImportance: 0.7,
      consequence: 'medium',
      actionability: 1,
      volatility: 'stable',
      sensitivity: 'normal',
      disclosurePolicy: 'referenceable',
      observedAt: source.createdAt,
      createdBy: 'runtime',
      evidenceRefs: [source.ref],
      temporalResolution: 'exact',
    }],
    ...overrides,
  };
}

const executionBase = {
  evidence: [source],
  extractionRunId: 'run-1',
  extractorId: 'turn-semantics',
  scopeContext: {
    sessionId: 'session-1',
    agentId: 'main',
    workspaceId: '/workspace',
    projectId: 'project-1',
  },
  policy: {
    write: 'confirm' as const,
    sensitiveWrite: 'confirm' as const,
    processing: 'local_only' as const,
  },
};

describe('user model capture admission', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('honors an explicit scoped remember command without widening scope', () => {
    const result = executeUserModelInterpretation({ ...executionBase, interpretation: interpretation() });
    expect(result).toMatchObject({ proposed: 1, created: 1, rejected: 0 });
    expect(getUserAssertion(result.createdAssertions[0]!.id)).toMatchObject({
      authority: 'user_explicit',
      status: 'active',
    });
  });

  it('rejects an extractor scope outside the active execution context', () => {
    const result = executeUserModelInterpretation({
      ...executionBase,
      interpretation: interpretation({
        candidates: [{ ...interpretation().candidates[0]!, scope: { type: 'project', id: 'other' } }],
      }),
    });
    expect(result).toMatchObject({ proposed: 1, created: 0, rejected: 1 });
  });

  it('applies a targeted explicit correction as a superseding assertion', () => {
    const first = executeUserModelInterpretation({ ...executionBase, interpretation: interpretation() })
      .createdAssertions[0]!;
    const replacement = interpretation({
      intent: 'correct',
      targetAssertionIds: [first.id],
      candidates: [{
        ...interpretation().candidates[0]!,
        value: 'detailed',
        normalizedValue: 'detailed',
        statement: 'The user prefers detailed answers.',
        correctionOfAssertionId: first.id,
        observedAt: 2_000,
        validFrom: 2_000,
      }],
    });
    const result = executeUserModelInterpretation({ ...executionBase, interpretation: replacement });
    expect(result.outputs[0]).toMatchObject({ outcome: 'superseded' });
    expect(getUserAssertion(result.createdAssertions[0]!.id)?.supersedesAssertionId).toBe(first.id);
  });

  it('stages inferred goals and rules for confirmation without duplicates', () => {
    const structured = interpretation({
      intent: 'user_assertion',
      candidates: [],
      goals: [{
        title: 'Ship Atlas',
        desiredOutcome: 'Atlas is released safely.',
        scope: { type: 'project', id: 'project-1' },
        evidenceRefs: [source.ref],
      }],
      collaborationRules: [{
        category: 'communication',
        priority: 10,
        scope: { type: 'global' },
        conditions: { enforcementLevel: 'prompt' },
        statement: 'Keep answers concise.',
        evidenceRefs: [source.ref],
      }],
    });

    const first = executeUserModelInterpretation({ ...executionBase, interpretation: structured });
    const second = executeUserModelInterpretation({ ...executionBase, interpretation: structured });

    expect(first).toMatchObject({ created: 2, createdGoals: [{ status: 'proposed' }], createdRules: [{ status: 'disabled' }] });
    expect(listUserGoals()).toHaveLength(1);
    expect(listCollaborationRules()).toHaveLength(1);
    expect(second).toMatchObject({ created: 0, deduplicated: 2 });
  });
});
