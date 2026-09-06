import { describe, expect, it } from 'vitest';

import { parseTaskJudgeDecision, codingCompletionEvidence } from '../task-judge-service.js';

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
