import { cn } from '@/lib/cn';

import type { ModeStatusKind } from './backend-mode-card';
import type { BrowserMessages } from './types';

type StatusTone = 'ready' | 'pending' | 'error' | 'neutral';

function statusTone(kind: ModeStatusKind | undefined): StatusTone {
  switch (kind) {
    case 'ready':
      return 'ready';
    case 'not_installed':
    case 'checking':
      return 'pending';
    case 'error':
      return 'error';
    default:
      return 'neutral';
  }
}

function toneClass(tone: StatusTone): string {
  switch (tone) {
    case 'ready':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
    case 'pending':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
    case 'error':
      return 'bg-red-500/15 text-red-700 dark:text-red-400';
    default:
      return 'bg-surface-hover text-fg-muted';
  }
}

function dotClass(tone: StatusTone): string {
  switch (tone) {
    case 'ready':
      return 'bg-emerald-500';
    case 'pending':
      return 'bg-amber-500';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-fg-subtle';
  }
}

export function BrowserStatusStrip({
  m,
  backendName,
  status,
  statusLabel,
}: {
  m: BrowserMessages;
  backendName: string;
  status: ModeStatusKind | undefined;
  statusLabel: string | undefined;
}) {
  const tone = statusTone(status);
  const label = statusLabel ?? m.browserStatusUnknown;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
          {m.browserStatusStripBackend}
        </p>
        <p className="truncate text-sm font-medium text-fg">{backendName}</p>
      </div>
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
          toneClass(tone),
        )}
      >
        <span className={cn('inline-block size-1.5 rounded-full', dotClass(tone))} aria-hidden />
        {label}
      </span>
    </div>
  );
}
