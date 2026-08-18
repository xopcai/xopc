import { describe, expect, it } from 'vitest';

import { parseOutcomeJudgeDecision } from '../outcome-judge-service.js';

describe('parseOutcomeJudgeDecision', () => {
  it('keeps only unique in-range criterion indexes', () => {
    expect(parseOutcomeJudgeDecision(`\`\`\`json
      {"completedCriteria":[2,0,2,-1,3,1.5],"needsUser":true,"nextAction":"  Confirm scope  ","reason":"Need a decision"}
    \`\`\``, 3)).toEqual({
      completedCriteria: [2, 0],
      needsUser: true,
      nextAction: 'Confirm scope',
      reason: 'Need a decision',
    });
  });

  it('rejects responses without a JSON object', () => {
    expect(() => parseOutcomeJudgeDecision('completed', 1)).toThrow('invalid JSON');
  });
});
