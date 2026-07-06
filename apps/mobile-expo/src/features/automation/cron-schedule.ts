/** Mobile cron schedule — three presets only, no cron-parser dependency. */

export type ScheduleMode = 'interval' | 'daily' | 'weekdays';

export type IntervalPreset = 15 | 30 | 60;

export type ScheduleState = {
  mode: ScheduleMode;
  intervalMinutes: IntervalPreset;
  hour: number;
  minute: number;
};

export const DEFAULT_SCHEDULE: ScheduleState = {
  mode: 'weekdays',
  intervalMinutes: 30,
  hour: 9,
  minute: 0,
};

export function buildCronSchedule(state: ScheduleState): string {
  const minute = clamp(state.minute, 0, 59);
  const hour = clamp(state.hour, 0, 23);

  switch (state.mode) {
    case 'interval':
      if (state.intervalMinutes === 60) return '0 * * * *';
      return `*/${state.intervalMinutes} * * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekdays':
      return `${minute} ${hour} * * 1-5`;
  }
}

export function parseCronSchedule(expr: string): ScheduleState {
  const raw = expr.trim();

  const interval = raw.match(/^\*\/(\d+) \* \* \* \*$/);
  if (interval) {
    const n = Number(interval[1]);
    if (n === 15 || n === 30) {
      return { mode: 'interval', intervalMinutes: n, hour: 9, minute: 0 };
    }
  }

  if (raw === '0 * * * *') {
    return { mode: 'interval', intervalMinutes: 60, hour: 0, minute: 0 };
  }

  const daily = raw.match(/^(\d+) (\d+) \* \* \*$/);
  if (daily) {
    return {
      mode: 'daily',
      intervalMinutes: 30,
      hour: Number(daily[2]),
      minute: Number(daily[1]),
    };
  }

  const weekdays = raw.match(/^(\d+) (\d+) \* \* 1-5$/);
  if (weekdays) {
    return {
      mode: 'weekdays',
      intervalMinutes: 30,
      hour: Number(weekdays[2]),
      minute: Number(weekdays[1]),
    };
  }

  return { ...DEFAULT_SCHEDULE };
}

export type ScheduleLabels = {
  every15Min: string;
  every30Min: string;
  everyHour: string;
  dailyAt: string;
  weekdaysAt: string;
};

export function formatScheduleLabel(
  expr: string,
  locale: string,
  labels: ScheduleLabels,
): string {
  const trimmed = expr.trim();
  if (!trimmed) return '—';

  const state = parseCronSchedule(trimmed);
  if (buildCronSchedule(state) !== trimmed) {
    return trimmed;
  }

  switch (state.mode) {
    case 'interval':
      if (state.intervalMinutes === 15) return labels.every15Min;
      if (state.intervalMinutes === 30) return labels.every30Min;
      return labels.everyHour;
    case 'daily':
      return labels.dailyAt.replace('{{time}}', formatTime(state.hour, state.minute, locale));
    case 'weekdays':
      return labels.weekdaysAt.replace('{{time}}', formatTime(state.hour, state.minute, locale));
  }
}

function formatTime(hour: number, minute: number, locale: string): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n) || 0));
}
