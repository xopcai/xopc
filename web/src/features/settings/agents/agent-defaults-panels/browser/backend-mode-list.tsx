import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/cn';

import { selectClassName } from '../../defaults-field-styles';

import type { BrowserMessages } from './types';
import type { ModeStatusKind } from './backend-mode-card';

export type BackendMode = 'local' | 'cloakbrowser' | 'cdp' | 'cloud' | 'extension';

export interface BackendModeOption {
  value: BackendMode;
  icon: LucideIcon;
  name: string;
  tagline: string;
  status?: ModeStatusKind;
  statusLabel?: string;
}

function statusDotClass(status: ModeStatusKind | undefined): string {
  switch (status) {
    case 'ready':
      return 'bg-emerald-500';
    case 'not_installed':
    case 'checking':
      return 'bg-amber-500';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-fg-subtle/60';
  }
}

/** Compact backend picker — native select instead of a five-row list. */
export function BackendModeList({
  value,
  onChange,
  onOpenConfig,
  options,
  m,
}: {
  value: BackendMode;
  onChange: (next: BackendMode) => void;
  onOpenConfig?: (backend: BackendMode) => void;
  options: BackendModeOption[];
  m: BrowserMessages;
}) {
  const selected = options.find((opt) => opt.value === value) ?? options[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <label htmlFor="browser-backend-select" className="text-sm font-medium text-fg">
          {m.browserPickerTitle}
        </label>
        <p className="text-xs leading-relaxed text-fg-muted">{m.browserPickerSubtitle}</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-2">
        <select
          id="browser-backend-select"
          className={cn(selectClassName(), 'min-w-0 flex-1 sm:max-w-md')}
          value={value}
          onChange={(e) => onChange(e.target.value as BackendMode)}
          aria-label={m.browserPickerTitle}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.name}
            </option>
          ))}
        </select>

        {onOpenConfig ? (
          <button
            type="button"
            className={cn(
              'inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-xs font-medium text-accent',
              'transition-colors hover:border-edge-strong hover:bg-surface-hover',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
            )}
            onClick={() => onOpenConfig(value)}
            aria-label={`${selected?.name ?? value} — ${m.browserGoToConfigure}`}
          >
            <span>{m.browserGoToConfigure}</span>
            <ChevronRight className="size-4 shrink-0" aria-hidden />
          </button>
        ) : null}
      </div>

      {selected ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {selected.statusLabel ? (
              <span
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-fg-muted"
                aria-label={selected.statusLabel}
              >
                <span
                  className={cn('inline-block size-1.5 rounded-full', statusDotClass(selected.status))}
                  aria-hidden
                />
                {selected.statusLabel}
              </span>
            ) : null}
          </div>
          <p className="text-xs leading-relaxed text-fg-muted">{selected.tagline}</p>
        </div>
      ) : null}
    </div>
  );
}
