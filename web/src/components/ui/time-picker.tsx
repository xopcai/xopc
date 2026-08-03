import * as Popover from '@radix-ui/react-popover';
import { Check, Clock3, X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type RefObject } from 'react';

import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_POPOVER_Z } from '@/lib/settings-shell-dialog-layer';
import { settingsShellPopoverZClass } from '@/lib/settings-shell-layer.utils';
import {
  useSettingsShellPopoverLayer,
  useSettingsShellPopoverPortalContainer,
} from '@/lib/settings-shell-layer-context';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function currentTime() {
  const now = new Date();
  return { hour: now.getHours(), minute: now.getMinutes() };
}

function formatTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export type TimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  allowEmpty?: boolean;
  clearLabel?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
  triggerClassName?: string;
  id?: string;
  name?: string;
  minuteStep?: number;
};

export function TimePicker({
  value,
  onChange,
  disabled,
  allowEmpty = false,
  clearLabel,
  ariaLabel,
  ariaLabelledBy,
  className,
  triggerClassName,
  id,
  name,
  minuteStep = 1,
}: TimePickerProps) {
  const parsedValue = parseTime(value);
  const fallback = parsedValue ?? currentTime();
  const [open, setOpen] = useState(false);
  const [draftHour, setDraftHour] = useState(fallback.hour);
  const [draftMinute, setDraftMinute] = useState(fallback.minute);
  const hourRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const minuteRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const settingsShellLayer = useSettingsShellPopoverLayer();
  const portalContainer = useSettingsShellPopoverPortalContainer();
  const popoverZ = settingsShellLayer === 'default'
    ? SETTINGS_SHELL_POPOVER_Z
    : settingsShellPopoverZClass(settingsShellLayer);
  const normalizedStep = Math.max(1, Math.min(60, Math.round(minuteStep)));
  const minutes = Array.from({ length: Math.ceil(60 / normalizedStep) }, (_, index) => index * normalizedStep)
    .filter((minute) => minute < 60);

  const commit = (hour: number, minute: number, close = false) => {
    setDraftHour(hour);
    setDraftMinute(minute);
    onChange(formatTime(hour, minute));
    if (close) setOpen(false);
  };

  const moveSelection = (
    event: KeyboardEvent<HTMLButtonElement>,
    values: number[],
    selected: number,
    select: (next: number) => void,
    refs: RefObject<Array<HTMLButtonElement | null>>,
  ) => {
    let nextIndex: number | null = null;
    const currentIndex = Math.max(0, values.indexOf(selected));
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % values.length;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + values.length) % values.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = values.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = values[nextIndex];
    select(next);
    refs.current?.[nextIndex]?.focus();
  };

  return (
    <div className={cn('relative min-w-0', className)}>
      <Popover.Root
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            const next = parseTime(value) ?? currentTime();
            setDraftHour(next.hour);
            setDraftMinute(next.minute);
          }
          setOpen(nextOpen);
        }}
      >
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-haspopup="listbox"
            className={cn(
              'box-border flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-edge bg-surface-panel px-3 text-left text-sm text-fg',
              'transition-colors hover:border-edge-strong focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20',
              allowEmpty && value && 'pr-9',
              disabled && 'cursor-not-allowed opacity-50 hover:border-edge',
              triggerClassName,
            )}
          >
            <Clock3 className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            <span className={cn('tabular-nums', !parsedValue && 'text-fg-subtle')}>
              {parsedValue ? formatTime(parsedValue.hour, parsedValue.minute) : '--:--'}
            </span>
          </button>
        </Popover.Trigger>

        <Popover.Portal container={portalContainer ?? undefined}>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className={cn(
              popoverZ,
              'w-[18rem] overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover outline-none',
            )}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              requestAnimationFrame(() => hourRefs.current[draftHour]?.focus());
            }}
          >
            <div className="flex items-center justify-between border-b border-edge-subtle bg-surface-subtle px-3 py-2.5">
              <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                <Clock3 className="size-3.5" aria-hidden="true" />
                {ariaLabel ?? 'HH:mm'}
              </span>
              <span className="font-mono text-base font-semibold tabular-nums text-fg">
                {formatTime(draftHour, draftMinute)}
              </span>
            </div>

            <div className="grid grid-cols-2 divide-x divide-edge-subtle p-2">
              <div className="pr-2">
                <div className="px-1 pb-1.5 text-[11px] font-semibold tracking-wider text-fg-subtle">HH</div>
                <div role="listbox" aria-label={`${ariaLabel ?? 'HH:mm'} HH`} className="grid max-h-56 grid-cols-3 gap-1 overflow-y-auto pr-1">
                  {HOURS.map((hour, index) => (
                    <button
                      key={hour}
                      ref={(element) => { hourRefs.current[index] = element; }}
                      type="button"
                      role="option"
                      aria-selected={draftHour === hour}
                      tabIndex={draftHour === hour ? 0 : -1}
                      className={cn(
                        'relative flex h-8 items-center justify-center rounded-md text-xs tabular-nums text-fg-muted transition-colors',
                        'hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
                        draftHour === hour && 'bg-accent-soft font-semibold text-accent-fg',
                      )}
                      onClick={() => commit(hour, draftMinute)}
                      onKeyDown={(event) => moveSelection(event, HOURS, draftHour, (next) => commit(next, draftMinute), hourRefs)}
                    >
                      {String(hour).padStart(2, '0')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pl-2">
                <div className="px-1 pb-1.5 text-[11px] font-semibold tracking-wider text-fg-subtle">MM</div>
                <div role="listbox" aria-label={`${ariaLabel ?? 'HH:mm'} MM`} className="grid max-h-56 grid-cols-3 gap-1 overflow-y-auto pr-1">
                  {minutes.map((minute, index) => (
                    <button
                      key={minute}
                      ref={(element) => { minuteRefs.current[index] = element; }}
                      type="button"
                      role="option"
                      aria-selected={draftMinute === minute}
                      tabIndex={draftMinute === minute ? 0 : -1}
                      className={cn(
                        'relative flex h-8 items-center justify-center rounded-md text-xs tabular-nums text-fg-muted transition-colors',
                        'hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
                        draftMinute === minute && 'bg-accent-soft font-semibold text-accent-fg',
                      )}
                      onClick={() => commit(draftHour, minute, true)}
                      onKeyDown={(event) => moveSelection(event, minutes, draftMinute, (next) => commit(draftHour, next), minuteRefs)}
                    >
                      <Check className={cn('absolute left-0.5 size-3', draftMinute !== minute && 'invisible')} aria-hidden="true" />
                      {String(minute).padStart(2, '0')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {allowEmpty && value ? (
        <button
          type="button"
          disabled={disabled}
          aria-label={clearLabel ?? ariaLabel}
          title={clearLabel}
          className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:pointer-events-none"
          onClick={() => onChange('')}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
      {name ? <input type="hidden" name={name} value={value} disabled={disabled} /> : null}
    </div>
  );
}
