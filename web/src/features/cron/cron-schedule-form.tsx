import { CronExpressionParser } from 'cron-parser';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';

import { cn } from '@/lib/cn';
import { formControlBorderFocusClass, selectControlBaseClass } from '@/lib/form-field-width';

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

export type CronSchedulePickerLabels = {
  scheduleTimeLabel: string;
  modeNoRepeat: string;
  modeInterval: string;
  intervalKindMinutes: string;
  intervalKindHours: string;
  modeHourly: string;
  modeDaily: string;
  modeWeekly: string;
  modeMonthly: string;
  modeCustom: string;
  minuteUnit: string;
  minuteAtHour: string;
  intervalMinutes: string;
  intervalHours: string;
  hourUnit: string;
  dayOfMonth: string;
  customCronHint: string;
  weekdays: [string, string, string, string, string, string, string];
};

const pickerSelectClass = cn(
  selectControlBaseClass,
  'min-w-0 shrink text-xs sm:min-w-[7rem] sm:max-w-[11rem]',
);

const timeInputClass = cn(
  'h-9 min-w-[6.5rem] shrink-0 rounded-lg border border-edge-subtle bg-surface-panel px-2 py-1.5 text-sm text-fg',
  formControlBorderFocusClass,
  'dark:bg-surface-panel',
);

const dateInputClass = cn(
  'h-9 min-w-[9.5rem] shrink-0 rounded-lg border border-edge-subtle bg-surface-panel px-2 py-1.5 text-sm text-fg',
  formControlBorderFocusClass,
);

const numberInputClass = cn(
  'h-9 w-14 shrink-0 rounded-lg border border-edge-subtle bg-surface-panel px-2 py-1.5 text-center text-sm tabular-nums text-fg',
  formControlBorderFocusClass,
);

const cronTextareaClass = cn(
  'min-h-[2.5rem] w-full rounded-lg border border-edge-subtle bg-surface-base px-3 py-2 font-mono text-xs text-fg',
  formControlBorderFocusClass,
);

function defaultTodayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

    /** Specific calendar day each year: minute hour dom mon * */
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

type CronSchedulePickerProps = {
  value: string;
  onChange: (cron: string) => void;
  labels: CronSchedulePickerLabels;
  disabled?: boolean;
};

export function CronSchedulePicker({ value, onChange, labels, disabled }: CronSchedulePickerProps) {
  const parsed = useMemo(() => cronExpressionToPickerState(value), [value]);

  const [mode, setMode] = useState<SchedulePickerMode>(parsed.mode);
  const [intervalKind, setIntervalKind] = useState<IntervalKind>(parsed.intervalKind);
  const [onceDate, setOnceDate] = useState(parsed.onceDate);
  const [intervalMinutes, setIntervalMinutes] = useState(parsed.intervalMinutes);
  const [intervalHours, setIntervalHours] = useState(parsed.intervalHours);
  const [minute, setMinute] = useState(parsed.minute);
  const [hour, setHour] = useState(parsed.hour);
  const [weekDays, setWeekDays] = useState<boolean[]>(parsed.weekDays);
  const [dayOfMonth, setDayOfMonth] = useState(parsed.dayOfMonth);
  const [rawCron, setRawCron] = useState(parsed.rawCron);
  const [intervalMinutesDraft, setIntervalMinutesDraft] = useState<string | null>(null);
  const [intervalHoursDraft, setIntervalHoursDraft] = useState<string | null>(null);

  useEffect(() => {
    const p = cronExpressionToPickerState(value);
    setMode(p.mode);
    setIntervalKind(p.intervalKind);
    setOnceDate(p.onceDate);
    setIntervalMinutes(p.intervalMinutes);
    setIntervalHours(p.intervalHours);
    setMinute(p.minute);
    setHour(p.hour);
    setWeekDays(p.weekDays);
    setDayOfMonth(p.dayOfMonth);
    setRawCron(p.rawCron);
    setIntervalMinutesDraft(null);
    setIntervalHoursDraft(null);
  }, [value]);

  const emit = useCallback(
    (patch: Partial<PickerState>) => {
      const next: PickerState = {
        mode,
        intervalKind,
        onceDate,
        intervalMinutes,
        intervalHours,
        minute,
        hour,
        weekDays,
        dayOfMonth,
        rawCron,
        ...patch,
      };
      onChange(buildCronFromPickerState(next));
    },
    [
      mode,
      intervalKind,
      onceDate,
      intervalMinutes,
      intervalHours,
      minute,
      hour,
      weekDays,
      dayOfMonth,
      rawCron,
      onChange,
    ],
  );

  const timeValue = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const onTimeChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (!v) return;
    const [hh, mm] = v.split(':').map((x) => parseInt(x, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return;
    emit({ minute: mm, hour: hh });
  };

  const modeRow = (
    <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-0.5">
      <select
        className={pickerSelectClass}
        disabled={disabled}
        value={mode}
        onChange={(e) => {
          const next = e.target.value as SchedulePickerMode;
          setMode(next);
          emit({ mode: next });
        }}
        aria-label={labels.scheduleTimeLabel}
      >
        <option value="no_repeat">{labels.modeNoRepeat}</option>
        <option value="interval">{labels.modeInterval}</option>
        <option value="hourly">{labels.modeHourly}</option>
        <option value="daily">{labels.modeDaily}</option>
        <option value="weekly">{labels.modeWeekly}</option>
        <option value="monthly">{labels.modeMonthly}</option>
        <option value="custom">{labels.modeCustom}</option>
      </select>

      {mode === 'no_repeat' && (
        <>
          <input
            type="date"
            disabled={disabled}
            className={dateInputClass}
            value={onceDate}
            onChange={(e) => {
              const v = e.target.value;
              setOnceDate(v);
              emit({ onceDate: v });
            }}
            aria-label={labels.modeNoRepeat}
          />
          <input
            type="time"
            step={60}
            disabled={disabled}
            className={timeInputClass}
            value={timeValue}
            onChange={onTimeChange}
            aria-label={labels.scheduleTimeLabel}
          />
        </>
      )}

      {mode === 'interval' && (
        <>
          <select
            className={cn(pickerSelectClass, 'w-auto min-w-[5rem]')}
            disabled={disabled}
            value={intervalKind}
            onChange={(e) => {
              const k = e.target.value as IntervalKind;
              setIntervalKind(k);
              setIntervalMinutesDraft(null);
              setIntervalHoursDraft(null);
              emit({ intervalKind: k });
            }}
            aria-label={labels.modeInterval}
          >
            <option value="minutes">{labels.intervalKindMinutes}</option>
            <option value="hours">{labels.intervalKindHours}</option>
          </select>
          {intervalKind === 'minutes' ? (
            <>
              <input
                type="number"
                min={1}
                max={59}
                disabled={disabled}
                className={numberInputClass}
                value={intervalMinutesDraft ?? String(intervalMinutes)}
                onChange={(e) => {
                  const next = e.target.value;
                  setIntervalMinutesDraft(next);
                  const raw = parseInt(next, 10);
                  if (Number.isFinite(raw) && raw >= 1 && raw <= 59) {
                    setIntervalMinutes(raw);
                    emit({ intervalMinutes: raw });
                  }
                }}
                onBlur={() => {
                  if (intervalMinutesDraft === null) return;
                  const raw = parseInt(intervalMinutesDraft, 10);
                  const v =
                    !Number.isFinite(raw) || raw < 1
                      ? 5
                      : Math.min(59, Math.max(1, Math.round(raw)));
                  setIntervalMinutes(v);
                  emit({ intervalMinutes: v });
                  setIntervalMinutesDraft(null);
                }}
                aria-label={labels.intervalMinutes}
              />
              <span className="shrink-0 text-sm text-fg-muted">{labels.minuteUnit}</span>
            </>
          ) : (
            <>
              <input
                type="number"
                min={1}
                max={23}
                disabled={disabled}
                className={numberInputClass}
                value={intervalHoursDraft ?? String(intervalHours)}
                onChange={(e) => {
                  const next = e.target.value;
                  setIntervalHoursDraft(next);
                  const raw = parseInt(next, 10);
                  if (Number.isFinite(raw) && raw >= 1 && raw <= 23) {
                    setIntervalHours(raw);
                    emit({ intervalHours: raw });
                  }
                }}
                onBlur={() => {
                  if (intervalHoursDraft === null) return;
                  const raw = parseInt(intervalHoursDraft, 10);
                  const v =
                    !Number.isFinite(raw) || raw < 1
                      ? 2
                      : Math.min(23, Math.max(1, Math.round(raw)));
                  setIntervalHours(v);
                  emit({ intervalHours: v });
                  setIntervalHoursDraft(null);
                }}
                aria-label={labels.intervalHours}
              />
              <span className="shrink-0 text-sm text-fg-muted">{labels.hourUnit}</span>
              <select
                className={cn(pickerSelectClass, 'w-auto min-w-[4rem]')}
                disabled={disabled}
                value={minute}
                onChange={(e) => {
                  const mm = parseInt(e.target.value, 10);
                  setMinute(mm);
                  emit({ minute: mm });
                }}
                aria-label={labels.minuteAtHour}
              >
                {Array.from({ length: 60 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}
                  </option>
                ))}
              </select>
              <span className="shrink-0 text-sm text-fg-muted">{labels.minuteUnit}</span>
            </>
          )}
        </>
      )}

      {mode === 'daily' && (
        <input
          type="time"
          step={60}
          disabled={disabled}
          className={timeInputClass}
          value={timeValue}
          onChange={onTimeChange}
          aria-label={labels.scheduleTimeLabel}
        />
      )}

      {mode === 'weekly' && (
        <input
          type="time"
          step={60}
          disabled={disabled}
          className={timeInputClass}
          value={timeValue}
          onChange={onTimeChange}
          aria-label={labels.scheduleTimeLabel}
        />
      )}

      {mode === 'monthly' && (
        <>
          <select
            className={cn(pickerSelectClass, 'w-auto min-w-[4.5rem]')}
            disabled={disabled}
            value={dayOfMonth}
            onChange={(e) => {
              const d = parseInt(e.target.value, 10);
              setDayOfMonth(d);
              emit({ dayOfMonth: d });
            }}
            aria-label={labels.dayOfMonth}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <input
            type="time"
            step={60}
            disabled={disabled}
            className={timeInputClass}
            value={timeValue}
            onChange={onTimeChange}
            aria-label={labels.scheduleTimeLabel}
          />
        </>
      )}

      {mode === 'hourly' && (
        <>
          <select
            className={cn(pickerSelectClass, 'w-auto min-w-[4rem]')}
            disabled={disabled}
            value={minute}
            onChange={(e) => {
              const mm = parseInt(e.target.value, 10);
              setMinute(mm);
              emit({ minute: mm });
            }}
            aria-label={labels.minuteAtHour}
          >
            {Array.from({ length: 60 }, (_, i) => (
              <option key={i} value={i}>
                {String(i).padStart(2, '0')}
              </option>
            ))}
          </select>
          <span className="shrink-0 text-sm text-fg-muted">{labels.minuteUnit}</span>
        </>
      )}
    </div>
  );

  const weekRow =
    mode === 'weekly' ? (
      <div className="flex flex-wrap gap-1.5 pt-1" role="group" aria-label={labels.modeWeekly}>
        {labels.weekdays.map((label, i) => {
          const on = weekDays[i];
          return (
            <button
              key={label}
              type="button"
              disabled={disabled}
              className={cn(
                'flex size-9 select-none items-center justify-center rounded-full border text-xs font-medium transition-colors',
                on
                  ? 'border-fg bg-fg text-surface-panel'
                  : 'border-edge-subtle bg-surface-panel text-fg hover:border-edge',
              )}
              aria-pressed={on}
              onClick={() => {
                const next = [...weekDays];
                next[i] = !next[i];
                setWeekDays(next);
                emit({ weekDays: next });
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    ) : null;

  const customBlock =
    mode === 'custom' ? (
      <div className="pt-1">
        <textarea
          disabled={disabled}
          className={cronTextareaClass}
          rows={2}
          spellCheck={false}
          value={rawCron}
          placeholder="*/5 * * * *"
          onChange={(e) => {
            const v = e.target.value;
            setRawCron(v);
            onChange(v.trim() || '*/5 * * * *');
          }}
          aria-label={labels.modeCustom}
        />
        <p className="mt-1 text-xs text-fg-muted">{labels.customCronHint}</p>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-fg-muted">{labels.scheduleTimeLabel}</span>
      {modeRow}
      {weekRow}
      {customBlock}
    </div>
  );
}
