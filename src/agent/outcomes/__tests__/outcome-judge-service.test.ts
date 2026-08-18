import { describe, expect, it } from 'vitest';

import { parseOutcomeJudgeDecision } from '../outcome-judge-service.js';

describe('parseOutcomeJudgeDecision', () => {
  it('keeps only unique in-range criterion indexes', () => {
    expect(parseOutcomeJudgeDecision(`\`\`\`json
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
    expect(() => parseOutcomeJudgeDecision('completed', 1)).toThrow('invalid JSON');
  });
});
