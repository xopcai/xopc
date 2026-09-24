import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCollaborationRule } from '../../storage/sqlite/collaboration-rule-repository.js';
import {
  closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { listActionRuleSuggestions, reconcileAssertion } from '../index.js';

describe('action rule suggestions', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
  });
  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('suggests only confirmed actionable patterns and never activates them', () => {
    const assertion = reconcileAssertion({
      subject: { type: 'user', id: 'self' }, predicate: 'preference.response.structure',
      cardinality: 'single', scope: { type: 'global' }, kind: 'preference',
      value: 'conclusion-first', normalizedValue: 'conclusion-first',
      statement: 'Lead with the conclusion.', authority: 'user_explicit', confidence: 1,
      inferredImportance: 0.8, consequence: 'low', actionability: 0.9, volatility: 'slow',
      sensitivity: 'normal', disclosurePolicy: 'referenceable', layer: 'pattern',
      allowedUses: ['answer', 'recommend'], observedAt: 1_000, createdBy: 'user',
    }, 1_000).assertion;
    expect(listActionRuleSuggestions()).toEqual([expect.objectContaining({
      sourceAssertionId: assertion.id,
      conditions: expect.objectContaining({ requiresConfirmation: true, enforcementLevel: 'prompt' }),
    })]);
    createCollaborationRule({
      category: 'communication', priority: 50, scope: { type: 'global' },
      statement: assertion.statement,
      conditions: { sourceAssertionId: assertion.id, enforcementLevel: 'prompt' },
    });
    expect(listActionRuleSuggestions()).toEqual([]);
  });
});
