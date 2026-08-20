import { CronExpressionParser } from 'cron-parser';

import type { DreamingSchedule } from '../../../user-context/config.js';

export const DEFAULT_DREAMING_SCHEDULES = {
  light: { kind: 'interval', everyHours: 6, minute: 0 },
  deep: { kind: 'daily', time: '03:00' },
  rem: { kind: 'weekly', weekday: 0, time: '05:00' },
} as const satisfies Record<'light' | 'deep' | 'rem', DreamingSchedule>;

export function resolveDreamingTimezone(timezone?: string): string {
  if (timezone) return timezone;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function compileDreamingSchedule(schedule: DreamingSchedule): string {
  if (schedule.kind === 'interval') return `${schedule.minute} */${schedule.everyHours} * * *`;
  const [hour, minute] = schedule.time.split(':').map(Number);
  if (schedule.kind === 'daily') return `${minute} ${hour} * * *`;
  return `${minute} ${hour} * * ${schedule.weekday}`;
}

export function nextDreamingRunTimes(
  schedule: DreamingSchedule,
  timezone: string,
  options: { fromMs?: number; limit?: number } = {},
): string[] {
  const limit = Math.max(0, Math.min(10, options.limit ?? 3));
  const expression = CronExpressionParser.parse(compileDreamingSchedule(schedule), {
    currentDate: new Date(options.fromMs ?? Date.now()),
    tz: timezone,
  });
  return Array.from({ length: limit }, () => expression.next().toISOString());
}
