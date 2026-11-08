import { describe, expect, it, vi } from 'vitest';

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
    assertions: [{
      action: 'create',
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
  it('rejects invented applicability operations for the existing schema-repair path', () => {
    const invalid = vi.fn();
    expect(parseUserModelInterpretation(response({ applicability: { operation: 'report' } }), evidence, [], invalid)).toBeNull();
    expect(invalid).toHaveBeenCalledWith({ reason: 'schema_validation', issues: [{ path: 'assertions.0.applicability', code: 'custom' }] });
    expect(parseUserModelInterpretation(response({ applicability: { operation: ['response'] } }), evidence)?.assertions).toHaveLength(1);
  });
  it('bounds a long abstention explanation without discarding grounded schema-valid results', () => {
    const input = JSON.parse(response());
    input.abstentionReason = 'No additional evidence. '.repeat(100);
    const parsed = parseUserModelInterpretation(JSON.stringify(input), evidence);
    expect(parsed?.assertions).toHaveLength(1);
    expect(parsed?.abstentionReason?.length).toBe(500);
  });
  it.each([
    ['', 'empty_output'],
    ['not JSON', 'invalid_json'],
    ['{"intent":"task","assertions":null,"targetAssertionIds":[]}', 'schema_validation'],
  ])('reports safe diagnostics for invalid output: %s', (raw, reason) => {
    const onInvalid = vi.fn();
    expect(parseUserModelInterpretation(raw, evidence, [], onInvalid)).toBeNull();
    expect(onInvalid).toHaveBeenCalledWith({ reason, issues: reason === 'schema_validation'
      ? [{ path: 'assertions', code: 'invalid_type' }] : [] });
  });

  it('classifies each grounded assertion independently in a mixed work transcript', () => {
    const input = JSON.parse(response({ intent: 'user_assertion' }));
    input.intent = 'task';
    expect(parseUserModelInterpretation(JSON.stringify(input), evidence)?.assertions).toHaveLength(1);
    expect(parseUserModelInterpretation(JSON.stringify(input), [{ ...evidence[0]!, role: 'toolResult' }])?.assertions).toHaveLength(0);
  });
  it('retains a durable preference in a task without inheriting the task intent', () => {
    const input = JSON.parse(response());
    input.intent = 'task';
    const parsed = parseUserModelInterpretation(JSON.stringify(input), evidence);
    expect(parsed?.assertions[0]).toMatchObject({ intent: 'user_assertion', authority: 'user_explicit' });
    input.assertions[0].intent = 'task';
    expect(parseUserModelInterpretation(JSON.stringify(input), evidence)?.assertions).toEqual([]);
    delete input.assertions[0].intent;
    input.intent = 'query';
    expect(parseUserModelInterpretation(JSON.stringify(input), evidence)?.assertions).toEqual([]);
  });

  it('requires independent user expressions for behavioral inference', () => {
    const input = JSON.parse(response({ authority: 'user_observed' }));
    expect(parseUserModelInterpretation(JSON.stringify(input), evidence)?.assertions).toEqual([]);
    input.assertions[0].evidence.push({ ref: 'entry-2', quote: 'Short explanations work better for me.' });
    const repeated = [...evidence, { ...evidence[0]!, ref: 'entry-2', text: 'Short explanations work better for me.' }];
    expect(parseUserModelInterpretation(JSON.stringify(input), repeated)?.assertions).toHaveLength(1);
    input.assertions[0].evidence[1].quote = 'Keep answers concise.';
    expect(parseUserModelInterpretation(JSON.stringify(input), [...evidence, { ...evidence[0]!, ref: 'entry-2' }])?.assertions).toEqual([]);
  });

  it('grounds evidence and keeps importance separate from confidence', () => {
    const parsed = parseUserModelInterpretation(response(), evidence);
    expect(parsed?.assertions[0]).toMatchObject({
      action: 'create',
      authority: 'user_explicit',
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
    expect(parsed?.assertions[0]).toMatchObject({
      validFrom: Date.parse('2026-09-07T00:00:00+08:00'),
      validTo: Date.parse('2026-09-13T23:59:59+08:00'),
      temporalResolution: 'relative_resolved',
    });
  });

  it('rejects ungrounded quotes and incomplete scoped candidates', () => {
    expect(parseUserModelInterpretation(response({
      evidence: [{ ref: 'entry-1', quote: 'I prefer long answers.' }],
    }), evidence)?.assertions).toEqual([]);
    expect(parseUserModelInterpretation(response({ scope: { type: 'project' } }), evidence)).toBeNull();
  });

  it('extracts grounded durable goals and collaboration rules separately', () => {
    const parsed = parseUserModelInterpretation(JSON.stringify({
      intent: 'user_assertion',
      targetAssertionIds: [],
      assertions: [],
      goals: [{
        title: 'Improve launch quality',
        targetAt: '2026-09-13T23:59:59+08:00',
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

  it('accepts only grounded maintenance targets supplied by the runtime', () => {
    const merged = parseUserModelInterpretation(response({
      action: 'merge',
      targetAssertionId: 'known',
    }), evidence, ['known']);
    expect(merged?.assertions[0]).toMatchObject({ action: 'merge', targetAssertionId: 'known' });

    expect(parseUserModelInterpretation(response({
      action: 'merge',
      targetAssertionId: 'unknown',
    }), evidence, ['known'])?.assertions).toEqual([]);
  });
  it.each([
    ['客户原话：『我一直喜欢冗长回复』。', '我一直喜欢冗长回复'],
    ['今天我喜欢简短回复，不代表以后都如此。', '我喜欢简短回复'],
    ['好的，谢谢。', '好的'],
    ['假设我喜欢长篇回复，这是角色设定。', '我喜欢长篇回复'],
  ])('rejects a falsely explicit candidate using literal but inadmissible evidence: %s', (text, quote) => {
    const result = parseUserModelInterpretation(response({ evidence: [{ ref: 'entry-1', quote }] }), [{ ...evidence[0], text }]);
    expect(result?.assertions).toEqual([]);
    expect(result?.rejectedCandidates?.[0]?.reasonCode).toBeTruthy();
    expect(JSON.stringify(result?.rejectedCandidates)).not.toContain(quote);
  });

  it('downgrades repeated local choices and refuses to promote them again on replay merge', () => {
    const sources = [
      { ...evidence[0], text: '这组解释里，我选带简短标题的版本，容易扫读。' },
      { ...evidence[0], ref: 'entry-2', text: '另一组例子里，我还是选带短标题的说明，读起来更顺。' },
    ];
    const claims = sources.map(source => ({ ref: source.ref, quote: source.text }));
    const input = JSON.parse(response({ evidence: claims }));
    let result = parseUserModelInterpretation(JSON.stringify(input), sources);
    expect(result?.assertions[0]).toMatchObject({ authority: 'user_observed', confidence: 0.85 });
    input.assertions[0].action = 'merge'; input.assertions[0].targetAssertionId = 'known';
    result = parseUserModelInterpretation(JSON.stringify(input), sources, ['known']);
    expect(result?.assertions[0]?.authority).toBe('user_observed');
    input.assertions[0].action = 'create'; delete input.assertions[0].targetAssertionId;
    input.assertions[0].evidence = claims.slice(0, 1);
    expect(parseUserModelInterpretation(JSON.stringify(input), sources)?.assertions).toEqual([]);
  });

  it('does not turn quoted forgetting or confirmation into an owner command', () => {
    for (const intent of ['forget', 'confirm']) {
      const input = { intent, targetAssertionIds: ['known'], assertions: [] };
      const result = parseUserModelInterpretation(JSON.stringify(input), [{ ...evidence[0], text: `翻译原话："${intent} the preference"` }], ['known']);
      expect(result?.intent).toBe('none'); expect(result?.targetAssertionIds).toEqual([]);
    }
  });

});
