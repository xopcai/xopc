import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, CircleHelp, LoaderCircle, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

import type { BrowserMessages } from './types';

export type ModeStatusKind = 'ready' | 'not_installed' | 'checking' | 'unknown' | 'error';

export function BackendModeCard({
  icon: Icon,
  title,
  description,
  status,
  statusDetail,
  primaryAction,
  children,
  advanced,
  m,
  embedded = false,
  sectionTitle,
  advancedTitle,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  status?: ModeStatusKind;
  statusDetail?: string;
  primaryAction?: ReactNode;
  children?: ReactNode;
  /** Optional extra fields block, always visible below main content. */
  advanced?: ReactNode;
  /** Section heading for {@link advanced} (e.g. "Paths & fingerprint"). */
  advancedTitle?: string;
  m: BrowserMessages;
  /** Inside {@link BrowserWorkspace}: omit outer chrome; optional sub-section title. */
  embedded?: boolean;
  sectionTitle?: string;
}) {
  const advancedBlock = advanced ? (
    <div className="flex flex-col gap-4">
      {advancedTitle ? <h4 className="text-sm font-medium text-fg">{advancedTitle}</h4> : null}
      {advanced}
    </div>
  ) : null;

  if (embedded) {
    return (
      <div className="flex flex-col gap-4">
        {sectionTitle ? (
          <div className="flex flex-col gap-0.5">
            <h4 className="text-sm font-medium text-fg">{sectionTitle}</h4>
            {description ? <p className="text-xs leading-relaxed text-fg-muted">{description}</p> : null}
          </div>
        ) : null}
        {status || primaryAction ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            {status ? (
              <div className="min-w-0 flex-1">
                <StatusBadge kind={status} detail={statusDetail} m={m} />
              </div>
            ) : (
              <span />
            )}
            {primaryAction ? <div className="shrink-0">{primaryAction}</div> : null}
          </div>
        ) : null}
        {children ? <div className="flex flex-col gap-4">{children}</div> : null}
        {advancedBlock}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-surface-panel/80 p-4 shadow-surface">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted">
          <Icon className="size-4" strokeWidth={1.75} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-fg">{title}</div>
            {status ? <StatusBadge kind={status} detail={statusDetail} m={m} /> : null}
          </div>
          <p className="text-xs leading-relaxed text-fg-muted">{description}</p>
        </div>
        {primaryAction ? <div className="shrink-0">{primaryAction}</div> : null}
      </div>

      {children ? <div className="flex flex-col gap-4">{children}</div> : null}
      {advancedBlock}
    </div>
  );
}

function StatusBadge({
  kind,
  detail,
  m,
}: {
  kind: ModeStatusKind;
  detail?: string;
  m: BrowserMessages;
}) {
  const config: Record<ModeStatusKind, { icon: LucideIcon; color: string; label: string }> = {
    ready: { icon: CheckCircle2, color: 'text-green-600 dark:text-green-400', label: m.browserStatusReady },
    not_installed: { icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-400', label: m.browserStatusNotInstalled },
    checking: { icon: LoaderCircle, color: 'text-fg-muted', label: m.browserStatusChecking },
    unknown: { icon: CircleHelp, color: 'text-fg-muted', label: m.browserStatusUnknown },
    error: { icon: XCircle, color: 'text-red-600 dark:text-red-400', label: m.browserStatusError },
  };
  const { icon: Icon, color, label } = config[kind];
  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-1">
      <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium', color)}>
        <Icon className={cn('size-3.5 shrink-0', kind === 'checking' && 'animate-spin')} />
        <span>{label}</span>
      </span>
      {detail ? (
        <span className="break-all font-mono text-[11px] leading-snug text-fg-subtle">{detail}</span>
      ) : null}
    </span>
  );
}

export function ActionResultBox({
  kind,
  message,
}: {
  kind: 'success' | 'error';
  message: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-xs leading-relaxed',
        kind === 'success'
          ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
          : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300',
      )}
    >
      {message}
    </div>
  );
}
