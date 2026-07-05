import { useMemo, useRef, useState } from 'react';

import { HEARTBEAT_INTERVAL_PRESET_MS_ORDER } from '@/features/scheduling/interval/interval-presets';
import type { IntervalPresetLabels } from '@/features/scheduling/interval/format-interval-label';
import { cn } from '@/lib/cn';
import { formControlBorderFocusClass, selectTriggerClass } from '@/lib/form-field-width';
import { Select, SelectOption } from '@/components/ui/popover-select';

export type IntervalSchedulePickerLabels = {
  secondsLabel: string;
  presets: IntervalPresetLabels;
};

const numberInputClass = cn(
  'h-9 min-w-0 flex-1 rounded-lg border border-edge-subtle bg-surface-panel px-2.5 py-1.5 text-sm tabular-nums text-fg',
  formControlBorderFocusClass,
);

const presetSelectClass = cn(
  selectTriggerClass,
  'h-9 max-w-[11rem] shrink-0 text-xs sm:max-w-[12rem]',
);

function presetOptionLabel(ms: number, presets: IntervalPresetLabels): string {
  switch (ms) {
    case 30_000:
      return presets.every30s;
    case 60_000:
      return presets.every1min;
    case 300_000:
      return presets.every5min;
    case 600_000:
      return presets.every10min;
    case 900_000:
      return presets.every15min;
    case 1_800_000:
      return presets.every30min;
    case 3_600_000:
      return presets.every1h;
    case 7_200_000:
      return presets.every2h;
    default:
      return String(ms);
  }
}

type IntervalSchedulePickerProps = {
  valueMs: number;
  onChangeMs: (ms: number) => void;
  labels: IntervalSchedulePickerLabels;
  disabled?: boolean;
  presets?: readonly number[];
  minSeconds?: number;
};

export function IntervalSchedulePicker({
  valueMs,
  onChangeMs,
  labels,
  disabled,
  presets = HEARTBEAT_INTERVAL_PRESET_MS_ORDER,
  minSeconds = 1,
}: IntervalSchedulePickerProps) {
  const presetSet = useMemo(() => new Set(presets), [presets]);

  const intervalPresetSelectValue = useMemo(
    () => (presetSet.has(valueMs) ? String(valueMs) : ''),
    [presetSet, valueMs],
  );

  const [secondsDraft, setSecondsDraft] = useState<string | null>(null);
  const trackedValueMsRef = useRef(valueMs);
  if (trackedValueMsRef.current !== valueMs) {
    trackedValueMsRef.current = valueMs;
    setSecondsDraft(null);
  }
  const secondsCommitted = Math.max(minSeconds, Math.round(valueMs / 1000));
  const secondsInputValue = secondsDraft !== null ? secondsDraft : String(secondsCommitted);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">{labels.secondsLabel}</span>
      <div className="flex gap-2">
        <input
          type="number"
          min={minSeconds}
          step={1}
          disabled={disabled}
          className={numberInputClass}
          value={secondsInputValue}
          onChange={(e) => {
            const next = e.target.value;
            setSecondsDraft(next);
            const raw = parseInt(next, 10);
            if (Number.isFinite(raw) && raw >= minSeconds) {
              onChangeMs(raw * 1000);
            }
          }}
          onBlur={() => {
            if (secondsDraft === null) return;
            const raw = parseInt(secondsDraft, 10);
            if (!Number.isFinite(raw) || raw < minSeconds) {
              onChangeMs(minSeconds * 1000);
            } else {
              onChangeMs(raw * 1000);
            }
            setSecondsDraft(null);
          }}
        />
        <Select
          className={presetSelectClass}
          disabled={disabled}
          value={intervalPresetSelectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v) {
              onChangeMs(parseInt(v, 10));
              setSecondsDraft(null);
            }
          }}
        >
          <SelectOption value="">{labels.presets.custom}</SelectOption>
          {presets.map((ms) => (
            <SelectOption key={ms} value={String(ms)}>
              {presetOptionLabel(ms, labels.presets)}
            </SelectOption>
          ))}
        </Select>
      </div>
    </div>
  );
}
