import { describe, expect, it } from 'vitest';

import { parseUserModelInterpretation, type CaptureEvidence } from '../semantic.js';

const evidence: CaptureEvidence[] = [{
  ref: 'entry-1',
  role: 'user',
  text: 'This week I am focused on launch quality. Keep answers concise.',
  createdAt: Date.parse('2026-09-07T08:00:00+08:00'),
}];

function response(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    intent: 'user_assertion',
    targetAssertionIds: [],
    candidates: [{
      subject: { type: 'user', id: 'self' },
      predicate: 'preference.response.detail',
      cardinality: 'single',
      scope: { type: 'global' },
      kind: 'preference',
      value: 'concise',
      normalizedValue: 'concise',
      statement: 'The user prefers concise answers.',
      authority: 'user_explicit',
      confidence: 0.95,
      declaredImportance: 0.8,
      inferredImportance: 0.7,
      consequence: 'medium',
      actionability: 1,
      volatility: 'stable',
      sensitivity: 'normal',
      disclosurePolicy: 'referenceable',
      applicability: { operation: 'response' },
      temporalResolution: 'exact',
      evidence: [{ ref: 'entry-1', quote: 'Keep answers concise.' }],
      selfContained: true,
      unresolvedReferences: [],
      ...overrides,
    }],
  });
}

describe('user model semantic capture', () => {
  it('grounds evidence and keeps importance separate from confidence', () => {
    const parsed = parseUserModelInterpretation(response(), evidence);
    expect(parsed?.candidates[0]).toMatchObject({
      authority: 'user_observed',
      confidence: 0.95,
      declaredImportance: 0.8,
      scope: { type: 'global' },
      observedAt: evidence[0]!.createdAt,
    });
  });

  it('preserves resolved valid time', () => {
    const parsed = parseUserModelInterpretation(response({
      kind: 'current_state',
      predicate: 'state.current_focus',
      value: 'launch quality',
      normalizedValue: 'launch quality',
      volatility: 'event',
      temporalResolution: 'relative_resolved',
      originalTimePhrase: 'This week',
      validFrom: '2026-09-07T00:00:00+08:00',
      validTo: '2026-09-13T23:59:59+08:00',
      evidence: [{ ref: 'entry-1', quote: 'This week I am focused on launch quality.' }],
    }), evidence);
    expect(parsed?.candidates[0]).toMatchObject({
      validFrom: Date.parse('2026-09-07T00:00:00+08:00'),
      validTo: Date.parse('2026-09-13T23:59:59+08:00'),
      temporalResolution: 'relative_resolved',
    });
  });

  it('rejects ungrounded quotes and incomplete scoped candidates', () => {
    expect(parseUserModelInterpretation(response({
      evidence: [{ ref: 'entry-1', quote: 'I prefer long answers.' }],
    }), evidence)?.candidates).toEqual([]);
    expect(parseUserModelInterpretation(response({ scope: { type: 'project' } }), evidence)).toBeNull();
  });

  it('extracts grounded durable goals and collaboration rules separately', () => {
    const parsed = parseUserModelInterpretation(JSON.stringify({
      intent: 'user_assertion',
      targetAssertionIds: [],
      candidates: [],
      goals: [{
        title: 'Improve launch quality',
        desiredOutcome: 'The launch passes the quality bar.',
        scope: { type: 'global' },
        evidence: [{ ref: 'entry-1', quote: 'focused on launch quality' }],
        selfContained: true,
        unresolvedReferences: [],
      }],
      collaborationRules: [{
        category: 'communication',
        priority: 10,
        scope: { type: 'global' },
        conditions: { enforcementLevel: 'prompt' },
        statement: 'Keep answers concise.',
        evidence: [{ ref: 'entry-1', quote: 'Keep answers concise.' }],
        selfContained: true,
        unresolvedReferences: [],
      }],
    }), evidence);

    expect(parsed?.goals).toEqual([expect.objectContaining({ title: 'Improve launch quality' })]);
    expect(parsed?.collaborationRules).toEqual([
      expect.objectContaining({ statement: 'Keep answers concise.' }),
    ]);
  });
});
