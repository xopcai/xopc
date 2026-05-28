import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';

import { cn } from '@/lib/cn';

import type { BrowserMessages } from './types';
import type { ModeStatusKind } from './backend-mode-card';

export type BackendMode = 'local' | 'cloakbrowser' | 'cdp' | 'cloud' | 'extension';

export interface BackendModeOption {
  value: BackendMode;
  icon: LucideIcon;
  name: string;
  tagline: string;
  /** Optional probed status to display as a small badge in the corner. */
  status?: ModeStatusKind;
  statusLabel?: string;
}

/**
 * Card grid for picking a browser backend. Selected card gets a coloured ring
 * + checkmark so users can see at a glance which backend is active.
 */
export function BackendModePicker({
  value,
  onChange,
  options,
  m,
}: {
  value: BackendMode;
  onChange: (next: BackendMode) => void;
  options: BackendModeOption[];
  m: BrowserMessages;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col">
        <div className="text-sm font-medium text-fg">{m.browserPickerTitle}</div>
        <p className="text-xs leading-relaxed text-fg-muted">{m.browserPickerSubtitle}</p>
      </div>
      <div
        role="radiogroup"
        aria-label={m.browserPickerTitle}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        {options.map((opt) => {
          const selected = opt.value === value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(opt.value)}
              className={cn(
                'group flex flex-col gap-2 rounded-xl border bg-surface-panel p-3 text-left transition-[border-color,background-color,box-shadow]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
                selected
                  ? 'border-accent bg-accent/5 ring-1 ring-accent/40 shadow-sm'
                  : 'border-edge hover:border-edge-strong hover:bg-surface-hover',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors',
                    selected ? 'bg-accent/15 text-accent' : 'bg-surface-hover text-fg-muted',
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.75} />
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {opt.statusLabel ? (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                        opt.status === 'ready'
                          ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
                          : opt.status === 'not_installed'
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            : opt.status === 'error'
                              ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300'
                              : 'border-edge bg-surface-hover text-fg-subtle',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block size-1.5 rounded-full',
                          opt.status === 'ready'
                            ? 'bg-green-500'
                            : opt.status === 'not_installed'
                              ? 'bg-amber-500'
                              : opt.status === 'error'
                                ? 'bg-red-500'
                                : 'bg-fg-subtle',
                        )}
                      />
                      <span>{opt.statusLabel}</span>
                    </span>
                  ) : null}
                  {selected ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                      aria-hidden
                    >
                      <Check className="size-3" strokeWidth={3} />
                      {m.browserSelectedBadge}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                <div className="text-sm font-semibold text-fg">{opt.name}</div>
                <p className="text-[11px] leading-snug text-fg-muted">{opt.tagline}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
