import { describe, expect, it } from 'vitest';

import { formatCronExpressionLabel } from '@/features/scheduling/cron/format-cron-label';

const labels = {
  everyMinute: 'Every minute',
  everyNMinutes: 'Every {{n}} minutes',
  everyNHours: 'Every {{n}} hours',
  hourly: 'Hourly',
  dailyAt: 'Daily, {{time}}',
  weekdaysAt: 'Weekdays, {{time}}',
  weekendsAt: 'Weekends, {{time}}',
  weeklyOn: '{{day}}, {{time}}',
  daysAt: '{{days}} at {{time}}',
  monthlyAt: 'Monthly on day {{day}}, {{time}}',
  customSchedule: 'Custom schedule',
  cronExpr: '{{expr}}',
};

describe('formatCronExpressionLabel', () => {
  it('describes weekday morning schedules in plain language', () => {
    const label = formatCronExpressionLabel('0 7 * * 1-5', 'en-US', labels);
    expect(label).toMatch(/weekday/i);
    expect(label).toMatch(/7/i);
    expect(label).not.toContain('1-5');
    expect(label).not.toContain('*');
  });

  it('describes daily schedules', () => {
    const label = formatCronExpressionLabel('0 9 * * *', 'en-US', labels);
    expect(label).toMatch(/daily/i);
    expect(label).toMatch(/9/i);
  });

  it('describes multi-day weekly schedules', () => {
    const label = formatCronExpressionLabel('0 8 * * 1,3,5', 'en-US', labels);
    expect(label).toMatch(/mon/i);
    expect(label).toMatch(/wed/i);
    expect(label).toMatch(/fri/i);
    expect(label).not.toContain('1,3,5');
  });

  it('describes monthly schedules', () => {
    const label = formatCronExpressionLabel('30 6 15 * *', 'en-US', labels);
    expect(label).toMatch(/monthly/i);
    expect(label).toContain('15');
  });

  it('falls back to custom schedule instead of raw cron', () => {
    const label = formatCronExpressionLabel('15 10 1,15 * 2,4', 'en-US', labels);
    expect(label).toBe('Custom schedule');
    expect(label).not.toContain('1,15');
  });
});
