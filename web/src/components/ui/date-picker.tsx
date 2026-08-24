import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/cn';
import { settingsShellPopoverZClass } from '@/lib/settings-shell-layer.utils';
import {
  useSettingsShellPopoverLayer,
  useSettingsShellPopoverPortalContainer,
} from '@/lib/settings-shell-layer-context';
import { useLocaleStore } from '@/stores/locale-store';

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

export function toDatePickerValue(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

export function parseDatePickerValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day, 12);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null;
}

function calendarDays(month: Date, weekStartsOn: 0 | 1): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const leadingDays = (first.getDay() - weekStartsOn + 7) % 7;
  return Array.from(
    { length: 42 },
    (_, index) => new Date(first.getFullYear(), first.getMonth(), 1 - leadingDays + index, 12),
  );
}

function displayValue(value: string, language: 'en' | 'zh'): string {
  const date = parseDatePickerValue(value);
  if (!date) return '';
  if (language === 'zh') {
    return `${date.getFullYear()}/${padDatePart(date.getMonth() + 1)}/${padDatePart(date.getDate())}`;
  }
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function DatePicker({
  value,
  onChange,
  disabled,
  className,
  ariaLabel,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const language = useLocaleStore((state) => state.language);
  const locale = language === 'zh' ? 'zh-CN' : 'en';
  const selectedDate = parseDatePickerValue(value);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(
    () => selectedDate ?? new Date(),
  );
  const portalContainer = useSettingsShellPopoverPortalContainer();
  const layer = useSettingsShellPopoverLayer();
  const popoverZ = settingsShellPopoverZClass(layer, portalContainer !== null);
  const weekStartsOn = language === 'zh' ? 1 : 0;

  useEffect(() => {
    if (!open) return;
    const nextSelectedDate = parseDatePickerValue(value);
    if (nextSelectedDate) setVisibleMonth(nextSelectedDate);
  }, [open, value]);

  const days = useMemo(
    () => calendarDays(visibleMonth, weekStartsOn),
    [visibleMonth, weekStartsOn],
  );
  const weekDays = useMemo(() => {
    const sunday = new Date(2026, 7, 23, 12);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(sunday);
      date.setDate(sunday.getDate() + weekStartsOn + index);
      return new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(date);
    });
  }, [locale, weekStartsOn]);
  const todayValue = toDatePickerValue(new Date());
  const selectedValue = selectedDate ? toDatePickerValue(selectedDate) : '';
  const monthLabel = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
  }).format(visibleMonth);

  const selectDate = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            'flex h-10 w-full min-w-0 items-center justify-between gap-3 rounded-lg bg-surface-hover px-3 text-left text-sm text-fg outline-none transition-colors',
            'hover:bg-surface-active focus-visible:ring-2 focus-visible:ring-accent/40',
            disabled && 'cursor-not-allowed opacity-50',
            className,
          )}
        >
          <span className={cn('min-w-0 truncate tabular-nums', !value && 'text-fg-subtle')}>
            {displayValue(value, language) || placeholder || (language === 'zh' ? '选择日期' : 'Select date')}
          </span>
          <CalendarDays className="size-4 shrink-0 text-fg-muted" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer ?? undefined}>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            popoverZ,
            'w-[19rem] rounded-2xl bg-surface-panel p-3 shadow-float outline-none',
          )}
        >
          <div className="flex h-10 items-center justify-between gap-2 px-1">
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              aria-label={language === 'zh' ? '上个月' : 'Previous month'}
              onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1, 12))}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <div className="text-sm font-semibold text-fg">{monthLabel}</div>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              aria-label={language === 'zh' ? '下个月' : 'Next month'}
              onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1, 12))}
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-7" aria-hidden>
            {weekDays.map((day, index) => (
              <div key={`${day}-${index}`} className="flex h-8 items-center justify-center text-[11px] font-medium text-fg-subtle">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-1" role="grid">
            {days.map((date) => {
              const dayValue = toDatePickerValue(date);
              const isSelected = dayValue === selectedValue;
              const isToday = dayValue === todayValue;
              const outsideMonth = date.getMonth() !== visibleMonth.getMonth();
              return (
                <button
                  key={dayValue}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  aria-label={new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(date)}
                  className={cn(
                    'mx-auto flex size-9 items-center justify-center rounded-xl text-sm tabular-nums text-fg transition-colors',
                    'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    outsideMonth && 'text-fg-disabled',
                    isToday && !isSelected && 'bg-accent-soft font-semibold text-accent-fg',
                    isSelected && 'bg-accent font-semibold text-white hover:bg-accent-hover',
                  )}
                  onClick={() => selectDate(dayValue)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between px-1 pt-1">
            <button
              type="button"
              disabled={!value}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
              onClick={() => selectDate('')}
            >
              {language === 'zh' ? '清除' : 'Clear'}
            </button>
            <button
              type="button"
              className="rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-soft/80"
              onClick={() => selectDate(todayValue)}
            >
              {language === 'zh' ? '今天' : 'Today'}
            </button>
          </div>
          <Popover.Arrow className="fill-surface-panel" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
