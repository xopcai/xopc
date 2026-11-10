import { describe, expect, it } from 'vitest';

import { beginJourney, getJourneyMetrics, resetJourneyMetrics } from './diagnostics';

describe('local journey diagnostics', () => {
  it('correlates overlapping journeys and bounds retained numeric samples', () => {
    resetJourneyMetrics();
    const first = beginJourney('session_load');
    const second = beginJourney('session_load');
    first('request_started'); second('request_started'); first('settled');
    const metrics = getJourneyMetrics();
    expect(metrics[0].id).toBe(metrics[2].id);
    expect(metrics[1].id).not.toBe(metrics[0].id);
    for (let index = 0; index < 300; index++) first('sample');
    expect(getJourneyMetrics()).toHaveLength(200);
    metrics[0].phase = 'mutated';
    expect(getJourneyMetrics().some(sample => sample.phase === 'mutated')).toBe(false);
    expect(getJourneyMetrics().every(sample => sample.durationMs >= 0)).toBe(true);
    resetJourneyMetrics();
    expect(getJourneyMetrics()).toEqual([]);
  });
});
