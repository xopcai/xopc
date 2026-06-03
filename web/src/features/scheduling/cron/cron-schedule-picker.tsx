import { useCallback, useMemo, useReducer, useRef, type ChangeEvent } from 'react';

import {
  buildCronFromPickerState,
  cronExpressionToPickerState,
  type IntervalKind,
  type PickerState,
  type SchedulePickerMode,
} from '@/features/scheduling/cron/cron-expression';
import { cn } from '@/lib/cn';
import { formControlBorderFocusClass, selectControlBaseClass } from '@/lib/form-field-width';

const MINUTE_VALUES: readonly number[] = Array.from({ length: 60 }, (_, idx) => idx);

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
  weekdays: readonly string[];
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

type InternalState = PickerState & {
  intervalMinutesDraft: string | null;
  intervalHoursDraft: string | null;
};

function fromParsed(parsed: PickerState): InternalState {
  return { ...parsed, intervalMinutesDraft: null, intervalHoursDraft: null };
}

function toPickerState(state: InternalState): PickerState {
  const { intervalMinutesDraft: _minutesDraft, intervalHoursDraft: _hoursDraft, ...picker } = state;
  return picker;
}

type PickerAction =
  | { type: 'reset'; state: PickerState }
  | { type: 'replace'; state: InternalState };

function pickerReducer(_state: InternalState, action: PickerAction): InternalState {
  switch (action.type) {
    case 'reset':
      return fromParsed(action.state);
    case 'replace':
      return action.state;
  }
}

type CronSchedulePickerProps = {
  value: string;
  onChange: (cron: string) => void;
  labels: CronSchedulePickerLabels;
  disabled?: boolean;
  /** When false, hides the top "Scheduled time" label (e.g. when wrapped by ScheduleField). */
  showHeading?: boolean;
};

export function CronSchedulePicker({
  value,
  onChange,
  labels,
  disabled,
  showHeading = true,
}: CronSchedulePickerProps) {
  const parsed = useMemo(() => cronExpressionToPickerState(value), [value]);
  const [state, dispatch] = useReducer(pickerReducer, parsed, fromParsed);

  const trackedValueRef = useRef(value);
  if (trackedValueRef.current !== value) {
    trackedValueRef.current = value;
    dispatch({ type: 'reset', state: parsed });
  }

  const commitPicker = useCallback(
    (patch: Partial<InternalState>) => {
      const nextState = { ...state, ...patch };
      dispatch({ type: 'replace', state: nextState });
      const nextPicker = toPickerState(nextState);
      const prevPicker = toPickerState(state);
      const pickerChanged = (Object.keys(nextPicker) as (keyof PickerState)[]).some(
        (key) => nextPicker[key] !== prevPicker[key],
      );
      if (pickerChanged) {
        onChange(buildCronFromPickerState(nextPicker));
      }
    },
    [onChange, state],
  );

  const {
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
    intervalMinutesDraft,
    intervalHoursDraft,
  } = state;

  const timeValue = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const onTimeChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (!v) return;
    const [hh, mm] = v.split(':').map((x) => parseInt(x, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return;
    commitPicker({ minute: mm, hour: hh });
  };

  const modeRow = (
    <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-0.5">
      <select
        className={pickerSelectClass}
        disabled={disabled}
        value={mode}
        onChange={(e) => {
          const next = e.target.value as SchedulePickerMode;
          commitPicker({ mode: next });
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
              commitPicker({ onceDate: e.target.value });
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
              commitPicker({ intervalKind: k, intervalMinutesDraft: null, intervalHoursDraft: null });
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
                  const raw = parseInt(next, 10);
                  const patch: Partial<InternalState> = { intervalMinutesDraft: next };
                  if (Number.isFinite(raw) && raw >= 1 && raw <= 59) {
                    patch.intervalMinutes = raw;
                  }
                  commitPicker(patch);
                }}
                onBlur={() => {
                  if (intervalMinutesDraft === null) return;
                  const raw = parseInt(intervalMinutesDraft, 10);
                  const v =
                    !Number.isFinite(raw) || raw < 1
                      ? 5
                      : Math.min(59, Math.max(1, Math.round(raw)));
                  commitPicker({ intervalMinutes: v, intervalMinutesDraft: null });
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
                  const raw = parseInt(next, 10);
                  const patch: Partial<InternalState> = { intervalHoursDraft: next };
                  if (Number.isFinite(raw) && raw >= 1 && raw <= 23) {
                    patch.intervalHours = raw;
                  }
                  commitPicker(patch);
                }}
                onBlur={() => {
                  if (intervalHoursDraft === null) return;
                  const raw = parseInt(intervalHoursDraft, 10);
                  const v =
                    !Number.isFinite(raw) || raw < 1
                      ? 2
                      : Math.min(23, Math.max(1, Math.round(raw)));
                  commitPicker({ intervalHours: v, intervalHoursDraft: null });
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
                  commitPicker({ minute: mm });
                }}
                aria-label={labels.minuteAtHour}
              >
                {MINUTE_VALUES.map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, '0')}
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
              commitPicker({ dayOfMonth: d });
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
              commitPicker({ minute: mm });
            }}
            aria-label={labels.minuteAtHour}
          >
            {MINUTE_VALUES.map((m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, '0')}
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
                commitPicker({ weekDays: next });
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
            commitPicker({ rawCron: e.target.value });
          }}
          aria-label={labels.modeCustom}
        />
        <p className="mt-1 text-xs text-fg-muted">{labels.customCronHint}</p>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-2">
      {showHeading ? (
        <span className="text-xs font-medium text-fg-muted">{labels.scheduleTimeLabel}</span>
      ) : null}
      {modeRow}
      {weekRow}
      {customBlock}
    </div>
  );
}
