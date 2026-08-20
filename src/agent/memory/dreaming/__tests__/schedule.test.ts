import { describe, expect, it } from 'vitest';

import { UserContextDreamingSchema } from '../../../../user-context/config.js';
import { compileDreamingSchedule, nextDreamingRunTimes } from '../schedule.js';

describe('Dreaming schedule', () => {
  it('compiles supported semantic schedules at the automation boundary', () => {
    expect(compileDreamingSchedule({ kind: 'interval', everyHours: 6, minute: 0 })).toBe('0 */6 * * *');
    expect(compileDreamingSchedule({ kind: 'daily', time: '03:15' })).toBe('15 3 * * *');
    expect(compileDreamingSchedule({ kind: 'weekly', weekday: 0, time: '05:30' })).toBe('30 5 * * 0');
  });

  it('computes future runs in the configured timezone', () => {
    expect(nextDreamingRunTimes(
      { kind: 'daily', time: '03:00' },
      'Asia/Shanghai',
      { fromMs: Date.parse('2026-08-20T00:00:00.000Z'), limit: 2 },
    )).toEqual(['2026-08-20T19:00:00.000Z', '2026-08-21T19:00:00.000Z']);
  });

  it('rejects raw cron configuration', () => {
    expect(UserContextDreamingSchema.safeParse({
      mode: 'review',
      phases: { light: { cron: '0 */6 * * *' } },
    }).success).toBe(false);
  });
});
