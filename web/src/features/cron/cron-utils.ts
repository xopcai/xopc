import { CronExpressionParser } from 'cron-parser';

import type { CronJob, CronJobExecution, SessionChatId } from '@/features/cron/cron-api';

export function truncate(text: string | undefined, max: number): string {
  const s = text?.trim() || '';
  if (!s) return '—';
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function formatDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

export function formatTime(date: string): string {
  return new Date(date).toLocaleString();
}

type TimeLabels = {
  overdue: string;
  lessThanMinute: string;
  minutes: string;
  hours: string;
};

export function formatNextRun(date: Date | string, labels: TimeLabels): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  if (diff < 0) return labels.overdue;
  if (diff < 60000) return labels.lessThanMinute;
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return labels.minutes.replace('{{count}}', String(mins));
  }
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return labels.hours.replace('{{count}}', String(hours));
  }
  return d.toLocaleString();
}

type LastActiveLabels = {
  justNow: string;
  minutesAgo: string;
  hoursAgo: string;
  daysAgo: string;
};

export function formatLastActive(date: string, labels: LastActiveLabels): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 0) return labels.justNow;
  if (diff < 60000) return labels.justNow;
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return labels.minutesAgo.replace('{{count}}', String(mins));
  }
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return labels.hoursAgo.replace('{{count}}', String(hours));
  }
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return labels.daysAgo.replace('{{count}}', String(days));
  }
  return d.toLocaleDateString();
}

export function formatRecipientOptionLabel(item: SessionChatId, labels: LastActiveLabels): string {
  const when = formatLastActive(item.lastActive, labels);
  if (item.channel === 'telegram' && item.peerId) {
    const acc = item.accountId ?? 'default';
    const kind = item.peerKind ?? '';
    return `${acc} · ${kind} · ${item.peerId} · ${when}`;
  }
  return `${item.channel}: ${item.chatId} · ${when}`;
}

export function formatDeliveryToSummary(
  job: CronJob,
  channelLocalLabel: string,
): string {
  if (job.delivery?.channel === 'local') {
    return channelLocalLabel;
  }
  const to = job.delivery?.to ?? '';
  const parts = to.split(':');
  if (parts.length === 3 && (parts[1] === 'dm' || parts[1] === 'group')) {
    return `${parts[0]} · ${parts[1]} · ${parts[2]}`;
  }
  return to;
}

export function execStatusLabel(
  status: CronJobExecution['status'],
  labels: {
    running: string;
    success: string;
    failed: string;
    cancelled: string;
  },
): string {
  switch (status) {
    case 'running':
      return labels.running;
    case 'success':
      return labels.success;
    case 'failed':
      return labels.failed;
    case 'cancelled':
      return labels.cancelled;
    default:
      return status;
  }
}

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

function numericFieldValues(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
}

function uniformStep(sorted: number[]): number | null {
  if (sorted.length < 2) return null;
  const step = sorted[1] - sorted[0];
  if (step <= 0) return null;
  for (let i = 2; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] !== step) return null;
  }
  return step;
}

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

function fallbackFromNextRun(job: Pick<CronJob, 'next_run'>, locale: string): string {
  const raw = job.next_run;
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(locale, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Short human-readable schedule for task cards (cron expression + optional next run).
 */
export function formatScheduleBadge(
  job: Pick<CronJob, 'schedule' | 'timezone' | 'next_run'>,
  locale: string,
  labels: ScheduleBadgeLabels,
): string {
  const schedule = (job.schedule || '').trim();
  if (!schedule) {
    return fallbackFromNextRun(job, locale) || '—';
  }

  try {
    const expr = CronExpressionParser.parse(schedule, {
      ...(job.timezone ? { tz: job.timezone } : {}),
    });
    const f = expr.fields;

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

    if (
      hm &&
      f.dayOfMonth.isWildcard &&
      f.month.isWildcard &&
      f.dayOfWeek.isWildcard
    ) {
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

    const nextFallback = fallbackFromNextRun(job, locale);
    if (nextFallback) return nextFallback;
    return labels.cronExpr.replace('{{expr}}', schedule);
  } catch {
    const nextFallback = fallbackFromNextRun(job, locale);
    return nextFallback || labels.cronExpr.replace('{{expr}}', schedule);
  }
}
