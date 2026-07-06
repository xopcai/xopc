import { describe, expect, it } from 'vitest';

import {
  buildCronSchedule,
  formatScheduleLabel,
  parseCronSchedule,
  type ScheduleLabels,
} from '../cron-schedule';

const labels: ScheduleLabels = {
  every15Min: 'Every 15 min',
  every30Min: 'Every 30 min',
  everyHour: 'Every hour',
  dailyAt: 'Daily at {{time}}',
  weekdaysAt: 'Weekdays at {{time}}',
};

describe('cron-schedule', () => {
  it('builds interval schedules', () => {
    expect(
      buildCronSchedule({ mode: 'interval', intervalMinutes: 15, hour: 0, minute: 0 }),
    ).toBe('*/15 * * * *');
    expect(
      buildCronSchedule({ mode: 'interval', intervalMinutes: 60, hour: 0, minute: 0 }),
    ).toBe('0 * * * *');
  });

  it('builds daily and weekday schedules', () => {
    expect(
      buildCronSchedule({ mode: 'daily', intervalMinutes: 30, hour: 8, minute: 30 }),
    ).toBe('30 8 * * *');
    expect(
      buildCronSchedule({ mode: 'weekdays', intervalMinutes: 30, hour: 9, minute: 0 }),
    ).toBe('0 9 * * 1-5');
  });

  it('round-trips supported expressions', () => {
    const cases = ['*/15 * * * *', '*/30 * * * *', '0 * * * *', '30 8 * * *', '0 9 * * 1-5'];
    for (const expr of cases) {
      expect(buildCronSchedule(parseCronSchedule(expr))).toBe(expr);
    }
  });

  it('formats known schedules', () => {
    expect(formatScheduleLabel('*/30 * * * *', 'en', labels)).toBe('Every 30 min');
    expect(formatScheduleLabel('0 9 * * 1-5', 'en', labels)).toMatch(/^Weekdays at /);
  });
});
