import { describe, expect, it, vi } from 'vitest';

import { parseTaskJudgeDecision, requestTaskJudgeDecision, codingCompletionEvidence } from '../task-judge-service.js';

describe('parseTaskJudgeDecision', () => {
  it('keeps only unique in-range criterion indexes', () => {
    expect(parseTaskJudgeDecision(`\`\`\`json
      {"completedCriteria":[2,0,2,-1,3,1.5],"needsUser":true,"nextAction":"  Confirm scope  ","recommendation":"Approve the smaller scope","reasons":["Need a decision"],"rejectedAlternatives":[{"option":"Full scope","reason":"Too risky"}],"uncertainty":"Timing may change","confidence":0.82}
    \`\`\``, 3)).toEqual({
      completedCriteria: [2, 0],
      needsUser: true,
      nextAction: 'Confirm scope',
      judgment: {
        recommendation: 'Approve the smaller scope',
        reasons: ['Need a decision'],
        rejectedAlternatives: [{ option: 'Full scope', reason: 'Too risky' }],
        uncertainty: 'Timing may change',
        confidence: 0.82,
      },
    });
  });

  it('rejects responses without a JSON object', () => {
    expect(() => parseTaskJudgeDecision('completed', 1)).toThrow('invalid JSON');
    expect(() => parseTaskJudgeDecision('{"needsUser":false}', 1)).toThrow('incomplete decision');
  });

  it('retries a malformed judge response once and uses the valid decision', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce('{"completedCriteria":[0],"needsUser":false,"reasons":["Done"')
      .mockResolvedValueOnce('{"completedCriteria":[0],"needsUser":false,"reasons":["Verified"]}');
    const decision = await requestTaskJudgeDecision(complete, 1);
    expect(complete.mock.calls.map(([attempt]) => attempt)).toEqual([0, 1]);
    expect(decision.completedCriteria).toEqual([0]);
    expect(decision.judgment.reasons).toEqual(['Verified']);
  });

  it('does not invent completion when both judge responses are malformed', async () => {
    const complete = vi.fn().mockResolvedValue('{"completedCriteria":[0],"needsUser":false');
    await expect(requestTaskJudgeDecision(complete, 1)).rejects.toThrow();
    expect(complete).toHaveBeenCalledTimes(2);
  });
});


describe('coding completion evidence', () => {
  it('cannot approve an unfinished run or a stale check based on assistant text', () => {
    const start = { type: 'custom', customType: 'coding_run_started', data: { required: true } };
    expect(codingCompletionEvidence([start] as any).allowed).toBe(false);
    const final = { type: 'custom', customType: 'coding_verification', data: { required: true, changed: true,
      evidence: [{ kind: 'check', status: 'warning' }, { kind: 'diff-review', status: 'passed' }] } };
    expect(codingCompletionEvidence([start, final] as any).allowed).toBe(false);
    final.data.evidence[0]!.status = 'passed';
    expect(codingCompletionEvidence([start, final] as any).allowed).toBe(true);
  });
});
