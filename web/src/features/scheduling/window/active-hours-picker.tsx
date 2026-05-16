import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formControlBorderFocusClass } from '@/lib/form-field-width';

export type ActiveHoursValue = {
  start: string;
  end: string;
  timezone: string;
};

export type ActiveHoursPickerLabels = {
  start: string;
  end: string;
  timezone: string;
  add: string;
  clear: string;
};

const timeInputClass = cn(
  'mt-1 w-full rounded-lg border border-edge-subtle bg-surface-panel px-2.5 py-1.5 text-sm text-fg',
  formControlBorderFocusClass,
);

const defaultActiveHours = (): ActiveHoursValue => ({
  start: '09:00',
  end: '22:00',
  timezone: '',
});

type ActiveHoursPickerProps = {
  value: ActiveHoursValue | null;
  onChange: (value: ActiveHoursValue | null) => void;
  labels: ActiveHoursPickerLabels;
  disabled?: boolean;
};

export function ActiveHoursPicker({ value, onChange, labels, disabled }: ActiveHoursPickerProps) {
  if (!value) {
    return (
      <Button
        type="button"
        variant="secondary"
        className="text-sm"
        disabled={disabled}
        onClick={() => onChange(defaultActiveHours())}
      >
        {labels.add}
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block min-w-0">
          <span className="text-xs font-medium text-fg-muted">{labels.start}</span>
          <input
            type="time"
            step={60}
            disabled={disabled}
            className={timeInputClass}
            value={value.start}
            onChange={(e) => onChange({ ...value, start: e.target.value })}
          />
        </label>
        <label className="block min-w-0">
          <span className="text-xs font-medium text-fg-muted">{labels.end}</span>
          <input
            type="time"
            step={60}
            disabled={disabled}
            className={timeInputClass}
            value={value.end}
            onChange={(e) => onChange({ ...value, end: e.target.value })}
          />
        </label>
        <label className="block min-w-0">
          <span className="text-xs font-medium text-fg-muted">{labels.timezone}</span>
          <input
            type="text"
            disabled={disabled}
            className={timeInputClass}
            value={value.timezone}
            onChange={(e) => onChange({ ...value, timezone: e.target.value })}
            placeholder="Asia/Shanghai"
            autoComplete="off"
          />
        </label>
      </div>
      <Button
        type="button"
        variant="secondary"
        className="text-xs"
        disabled={disabled}
        onClick={() => onChange(null)}
      >
        {labels.clear}
      </Button>
    </div>
  );
}
