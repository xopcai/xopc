import { describe, expect, it } from 'vitest';

import { evaluateMemoryEpisodeSuite } from '../memory-episode-evaluator.js';

describe('evaluateMemoryEpisodeSuite', () => {
  it('blocks release when a forbidden record is recalled even if average recall is perfect', () => {
    const suite = evaluateMemoryEpisodeSuite([{
      episode: {
        id: 'scope-boundary',
        expectedRecall: ['allowed'],
        forbiddenRecall: ['other-session'],
        expectedLifecycle: ['supersede'],
        expectedDreaming: ['review'],
      },
      observation: {
        recalledRecordIds: ['allowed', 'other-session'],
        lifecycleActions: ['supersede'],
        dreamingActions: ['review'],
        scopeViolations: 1,
        sensitivityViolations: 0,
      },
    }]);

    expect(suite.averageRecall).toBe(1);
    expect(suite.releaseReady).toBe(false);
    expect(suite.results[0]).toMatchObject({ safe: false, forbiddenRecall: ['other-session'] });
  });
});
