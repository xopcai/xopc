import { useId } from 'react';

import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import { DatePicker } from './date-picker';
import { TimePicker } from './time-picker';

/** Edit a local date and time without converting it to an instant. */
export function DateTimePicker({ label, value, onChange, defaultTime, disabled, className }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  defaultTime: string;
  disabled?: boolean;
  className?: string;
}) {
  const labelId = useId();
  const zh = useLocaleStore(state => state.language) === 'zh';
  const [date, time] = value.split('T');
  const selectedTime = time?.slice(0, 5);

  return <div role="group" aria-labelledby={labelId} className={cn('grid min-w-0 gap-2 text-sm text-fg', className)}>
    <span id={labelId}>{label}</span>
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(5.5rem,0.6fr)] gap-2">
      <DatePicker ariaLabel={`${label} · ${zh ? '日期' : 'Date'}`} disabled={disabled} value={date}
        className="border border-edge bg-surface-panel hover:bg-surface-hover"
        onChange={next => onChange(next ? `${next}T${selectedTime || defaultTime}` : '')} />
      <TimePicker ariaLabel={`${label} · ${zh ? '时间' : 'Time'}`} disabled={disabled || !date}
        value={selectedTime ?? ''} onChange={next => onChange(`${date}T${next}`)} />
    </div>
  </div>;
}
