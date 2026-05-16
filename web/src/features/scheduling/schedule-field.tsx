import type { CronSchedulePickerLabels } from '@/features/scheduling/cron/cron-schedule-picker';
import { CronSchedulePicker } from '@/features/scheduling/cron/cron-schedule-picker';
import { IntervalSchedulePicker, type IntervalSchedulePickerLabels } from '@/features/scheduling/interval/interval-schedule-picker';
import { HEARTBEAT_INTERVAL_PRESET_MS_ORDER } from '@/features/scheduling/interval/interval-presets';
import {
  ActiveHoursPicker,
  type ActiveHoursPickerLabels,
  type ActiveHoursValue,
} from '@/features/scheduling/window/active-hours-picker';
import { cn } from '@/lib/cn';

type ScheduleFieldShellProps = {
  disabled?: boolean;
  label?: string;
  hint?: string;
  className?: string;
};

export type CronScheduleFieldProps = ScheduleFieldShellProps & {
  kind: 'cron';
  value: string;
  onChange: (cron: string) => void;
  labels: CronSchedulePickerLabels;
};

export type IntervalScheduleFieldProps = ScheduleFieldShellProps & {
  kind: 'interval';
  valueMs: number;
  onChangeMs: (ms: number) => void;
  labels: IntervalSchedulePickerLabels;
  presets?: readonly number[];
  minSeconds?: number;
};

export type ActiveHoursScheduleFieldProps = ScheduleFieldShellProps & {
  kind: 'active-hours';
  value: ActiveHoursValue | null;
  onChange: (value: ActiveHoursValue | null) => void;
  labels: ActiveHoursPickerLabels;
};

export type ScheduleFieldProps =
  | CronScheduleFieldProps
  | IntervalScheduleFieldProps
  | ActiveHoursScheduleFieldProps;

export type { ActiveHoursValue };

export function ScheduleField(props: ScheduleFieldProps) {
  const { disabled, label, hint, className } = props;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label ? <span className="text-xs font-medium text-fg-muted">{label}</span> : null}
      {props.kind === 'cron' ? (
        <CronSchedulePicker
          value={props.value}
          onChange={props.onChange}
          labels={props.labels}
          disabled={disabled}
          showHeading={!label}
        />
      ) : null}
      {props.kind === 'interval' ? (
        <IntervalSchedulePicker
          valueMs={props.valueMs}
          onChangeMs={props.onChangeMs}
          labels={props.labels}
          disabled={disabled}
          presets={props.presets ?? HEARTBEAT_INTERVAL_PRESET_MS_ORDER}
          minSeconds={props.minSeconds}
        />
      ) : null}
      {props.kind === 'active-hours' ? (
        <ActiveHoursPicker
          value={props.value}
          onChange={props.onChange}
          labels={props.labels}
          disabled={disabled}
        />
      ) : null}
      {hint ? <p className="text-xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}
