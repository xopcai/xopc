import { CronExpressionParser } from 'cron-parser';

import { numericFieldValues, uniformStep } from '@/features/scheduling/cron/cron-expression';

export type ScheduleBadgeLabels = {
  everyMinute: string;
  everyNMinutes: string;
  everyNHours: string;
  hourly: string;
  dailyAt: string;
  weekdaysAt: string;
  weeklyOn: string;
  cronExpr: string;
};

function formatHm(hour: number, minute: number, locale: string): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** `dow` as in cron-parser (0–7, Sun–Sat, 7 = Sun). */
function weekdayShort(dow: number, locale: string): string {
  const jsDay = dow === 7 ? 0 : dow;
  const ref = Date.UTC(2023, 0, 1);
  const d = new Date(ref + jsDay * 86400000);
  return d.toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' });
}

export function formatCronExpressionLabel(
  schedule: string,
  locale: string,
  labels: ScheduleBadgeLabels,
  options?: { timezone?: string; nextRun?: string | null },
): string {
  const expr = schedule.trim();
  if (!expr) {
    return fallbackFromNextRun(options?.nextRun, locale) || '—';
  }

  try {
    const parsed = CronExpressionParser.parse(expr, {
      ...(options?.timezone ? { tz: options.timezone } : {}),
    });
    const f = parsed.fields;

    const minuteVals = numericFieldValues(f.minute.values);
    const hourVals = numericFieldValues(f.hour.values);
    const dowVals = numericFieldValues(f.dayOfWeek.values);

    if (
      minuteVals.length === 60 &&
      f.hour.isWildcard &&
      f.dayOfMonth.isWildcard &&
      f.month.isWildcard &&
      f.dayOfWeek.isWildcard
    ) {
      return labels.everyMinute;
    }

    if (
      !f.minute.isWildcard &&
      f.hour.isWildcard &&
      f.dayOfMonth.isWildcard &&
      f.month.isWildcard &&
      f.dayOfWeek.isWildcard &&
      minuteVals.length > 1
    ) {
      const step = uniformStep(minuteVals);
      if (step != null && step > 0) {
        return labels.everyNMinutes.replace('{{n}}', String(step));
      }
    }

    if (
      !f.minute.isWildcard &&
      minuteVals.length === 1 &&
      !f.hour.isWildcard &&
      hourVals.length > 1 &&
      f.dayOfMonth.isWildcard &&
      f.month.isWildcard &&
      f.dayOfWeek.isWildcard
    ) {
      const step = uniformStep(hourVals);
      if (step != null && step > 0) {
        return labels.everyNHours.replace('{{n}}', String(step));
      }
    }

    if (
      !f.minute.isWildcard &&
      minuteVals.length === 1 &&
      f.hour.isWildcard &&
      f.dayOfMonth.isWildcard &&
      f.month.isWildcard &&
      f.dayOfWeek.isWildcard &&
      hourVals.length === 24
    ) {
      return labels.hourly;
    }

    const hm =
      !f.minute.isWildcard &&
      minuteVals.length === 1 &&
      !f.hour.isWildcard &&
      hourVals.length === 1
        ? formatHm(hourVals[0], minuteVals[0], locale)
        : '';

    if (hm && f.dayOfMonth.isWildcard && f.month.isWildcard && f.dayOfWeek.isWildcard) {
      return labels.dailyAt.replace('{{time}}', hm);
    }

    if (
      hm &&
      f.dayOfMonth.isWildcard &&
      f.month.isWildcard &&
      !f.dayOfWeek.isWildcard &&
      dowVals.length === 5 &&
      dowVals[0] === 1 &&
      dowVals[4] === 5
    ) {
      return labels.weekdaysAt.replace('{{time}}', hm);
    }

    if (
      hm &&
      f.dayOfMonth.isWildcard &&
      f.month.isWildcard &&
      !f.dayOfWeek.isWildcard &&
      dowVals.length === 1
    ) {
      const day = weekdayShort(dowVals[0], locale);
      return labels.weeklyOn.replace('{{day}}', day).replace('{{time}}', hm);
    }

    const nextFallback = fallbackFromNextRun(options?.nextRun, locale);
    if (nextFallback) return nextFallback;
    return labels.cronExpr.replace('{{expr}}', expr);
  } catch {
    const nextFallback = fallbackFromNextRun(options?.nextRun, locale);
    return nextFallback || labels.cronExpr.replace('{{expr}}', expr);
  }
}

function fallbackFromNextRun(nextRun: string | null | undefined, locale: string): string {
  if (!nextRun) return '';
  const d = new Date(nextRun);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(locale, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
