import { CronExpressionParser } from 'cron-parser';

/** Matches design order: 不重复 → 间隔 → 每小时 → 每天 → 每周 → 每月 → 自定义 */
export type SchedulePickerMode =
  | 'no_repeat'
  | 'interval'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'custom';

export type IntervalKind = 'minutes' | 'hours';

export type PickerState = {
  mode: SchedulePickerMode;
  intervalKind: IntervalKind;
  onceDate: string;
  intervalMinutes: number;
  intervalHours: number;
  minute: number;
  hour: number;
  weekDays: boolean[];
  dayOfMonth: number;
  rawCron: string;
};

function defaultTodayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function numericFieldValues(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
}

export function uniformStep(sorted: number[]): number | null {
  if (sorted.length < 2) return null;
  const step = sorted[1] - sorted[0];
  if (step <= 0) return null;
  for (let i = 2; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] !== step) return null;
  }
  return step;
}

/** UI week: index 0=Mon … 6=Sun → cron 1–6,0 */
function uiWeekDaysToCron(d: boolean[]): string {
  const parts: number[] = [];
  for (let i = 0; i < 7; i++) {
    if (!d[i]) continue;
    parts.push(i === 6 ? 0 : i + 1);
  }
  if (parts.length === 0) return '1';
  return parts.sort((a, b) => a - b).join(',');
}

function cronDowListToUiWeekDays(cronDows: number[]): boolean[] {
  const out = [false, false, false, false, false, false, false];
  for (const v of cronDows) {
    const js = v === 0 || v === 7 ? 6 : v - 1;
    if (js >= 0 && js <= 6) out[js] = true;
  }
  return out;
}

export function cronExpressionToPickerState(expr: string): PickerState {
  const rawCron = expr.trim();
  const fallback: PickerState = {
    mode: 'custom',
    intervalKind: 'minutes',
    onceDate: defaultTodayYmd(),
    intervalMinutes: 5,
    intervalHours: 2,
    minute: 0,
    hour: 9,
    weekDays: [true, true, true, true, true, false, false],
    dayOfMonth: 1,
    rawCron,
  };

  if (!rawCron) return { ...fallback, mode: 'interval', rawCron: '*/5 * * * *' };

  try {
    const p = CronExpressionParser.parse(rawCron);
    const f = p.fields;
    const m = numericFieldValues(f.minute.values);
    const h = numericFieldValues(f.hour.values);
    const dom = numericFieldValues(f.dayOfMonth.values);
    const mon = numericFieldValues(f.month.values);
    const dow = numericFieldValues(f.dayOfWeek.values);

    if (m.length === 60 && f.hour.isWildcard && f.dayOfMonth.isWildcard && f.month.isWildcard && f.dayOfWeek.isWildcard) {
      return { ...fallback, mode: 'interval', intervalKind: 'minutes', intervalMinutes: 1, rawCron };
    }
    if (
      !f.minute.isWildcard &&
      f.hour.isWildcard &&
      f.dayOfMonth.isWildcard &&
      f.month.isWildcard &&
      f.dayOfWeek.isWildcard &&
      m.length > 1
    ) {
      const step = uniformStep(m);
      if (step != null && step > 0) {
        return { ...fallback, mode: 'interval', intervalKind: 'minutes', intervalMinutes: step, rawCron };
      }
    }
    if (
      !f.minute.isWildcard &&
      m.length === 1 &&
      !f.hour.isWildcard &&
      h.length > 1 &&
      f.dayOfMonth.isWildcard &&
      f.month.isWildcard &&
      f.dayOfWeek.isWildcard
    ) {
      const step = uniformStep(h);
      if (step != null && step > 0) {
        return { ...fallback, mode: 'interval', intervalKind: 'hours', intervalHours: step, minute: m[0], rawCron };
      }
    }
    if (
      !f.minute.isWildcard &&
      m.length === 1 &&
      f.hour.isWildcard &&
      f.dayOfMonth.isWildcard &&
      f.month.isWildcard &&
      f.dayOfWeek.isWildcard &&
      h.length === 24
    ) {
      return { ...fallback, mode: 'hourly', minute: m[0], rawCron };
    }

    if (
      m.length === 1 &&
      h.length === 1 &&
      dom.length === 1 &&
      mon.length === 1 &&
      !f.dayOfMonth.isWildcard &&
      !f.month.isWildcard &&
      f.dayOfWeek.isWildcard
    ) {
      const y = new Date().getFullYear();
      const mo = mon[0];
      const d = dom[0];
      const onceDate = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return {
        ...fallback,
        mode: 'no_repeat',
        minute: m[0],
        hour: h[0],
        onceDate,
        rawCron,
      };
    }

    if (
      m.length === 1 &&
      h.length === 1 &&
      f.dayOfMonth.isWildcard &&
      f.month.isWildcard &&
      f.dayOfWeek.isWildcard
    ) {
      return {
        ...fallback,
        mode: 'daily',
        minute: m[0],
        hour: h[0],
        rawCron,
      };
    }
    if (
      m.length === 1 &&
      h.length === 1 &&
      f.dayOfMonth.isWildcard &&
      f.month.isWildcard &&
      !f.dayOfWeek.isWildcard &&
      dow.length > 0
    ) {
      return {
        ...fallback,
        mode: 'weekly',
        minute: m[0],
        hour: h[0],
        weekDays: cronDowListToUiWeekDays(dow),
        rawCron,
      };
    }
    if (
      m.length === 1 &&
      h.length === 1 &&
      !f.dayOfMonth.isWildcard &&
      dom.length === 1 &&
      f.month.isWildcard &&
      f.dayOfWeek.isWildcard
    ) {
      return {
        ...fallback,
        mode: 'monthly',
        minute: m[0],
        hour: h[0],
        dayOfMonth: dom[0],
        rawCron,
      };
    }
  } catch {
    /* fall through */
  }
  return fallback;
}

export function buildCronFromPickerState(s: PickerState): string {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

  switch (s.mode) {
    case 'custom':
      return s.rawCron.trim() || '*/5 * * * *';
    case 'no_repeat': {
      const parts = s.onceDate.split('-');
      if (parts.length === 3) {
        const dom = clamp(parseInt(parts[2], 10), 1, 31);
        const mo = clamp(parseInt(parts[1], 10), 1, 12);
        const min = clamp(s.minute, 0, 59);
        const h = clamp(s.hour, 0, 23);
        return `${min} ${h} ${dom} ${mo} *`;
      }
      return '0 9 1 1 *';
    }
    case 'interval':
      if (s.intervalKind === 'hours') {
        const n = clamp(Math.round(s.intervalHours) || 1, 1, 23);
        const min = clamp(s.minute, 0, 59);
        return `${min} */${n} * * *`;
      }
      {
        const n = clamp(Math.round(s.intervalMinutes) || 5, 1, 59);
        return `*/${n} * * * *`;
      }
    case 'hourly': {
      const min = clamp(s.minute, 0, 59);
      return `${min} * * * *`;
    }
    case 'daily': {
      const min = clamp(s.minute, 0, 59);
      const h = clamp(s.hour, 0, 23);
      return `${min} ${h} * * *`;
    }
    case 'weekly': {
      const min = clamp(s.minute, 0, 59);
      const h = clamp(s.hour, 0, 23);
      const dow = uiWeekDaysToCron(s.weekDays);
      return `${min} ${h} * * ${dow}`;
    }
    case 'monthly': {
      const min = clamp(s.minute, 0, 59);
      const h = clamp(s.hour, 0, 23);
      const dom = clamp(Math.round(s.dayOfMonth) || 1, 1, 31);
      return `${min} ${h} ${dom} * *`;
    }
    default:
      return '*/5 * * * *';
  }
}
