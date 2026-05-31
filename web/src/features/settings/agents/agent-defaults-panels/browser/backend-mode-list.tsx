import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/cn';

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

/**
 * Single-column backend picker. Selected row uses a left accent bar instead of
 * heavy badges to keep the page calm (design system §2.2).
 */
export function BackendModeList({
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
      </div>
      <div role="radiogroup" aria-label={m.browserPickerTitle} className="flex flex-col gap-1.5">
        {options.map((opt) => {
          const selected = opt.value === value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={opt.name}
              onClick={() => onChange(opt.value)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
                selected
                  ? 'border-accent/50 bg-accent/5 pl-[10px] shadow-[inset_3px_0_0_0] shadow-accent'
                  : 'border-edge bg-surface-panel hover:border-edge-strong hover:bg-surface-hover',
              )}
            >
              <div
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                  selected ? 'bg-accent/15 text-accent' : 'bg-surface-hover text-fg-muted',
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-fg">{opt.name}</div>
                <p className="truncate text-[11px] leading-snug text-fg-muted">{opt.tagline}</p>
              </div>
              {opt.statusLabel ? (
                <span
                  className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-fg-muted"
                  aria-label={opt.statusLabel}
                >
                  <span
                    className={cn('inline-block size-1.5 rounded-full', statusDotClass(opt.status))}
                    aria-hidden
                  />
                  <span className="hidden sm:inline">{opt.statusLabel}</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
