import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, CircleHelp, LoaderCircle, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';

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
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  status?: ModeStatusKind;
  statusDetail?: string;
  primaryAction?: ReactNode;
  children?: ReactNode;
  /** Collapsible "Advanced" section. */
  advanced?: ReactNode;
  m: BrowserMessages;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-edge bg-surface-panel p-4">
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

      {advanced ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="self-start text-xs font-medium text-fg-muted hover:text-fg"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? m.browserAdvancedHide : m.browserAdvancedShow}
          </button>
          {showAdvanced ? (
            <div className="flex flex-col gap-4 rounded-lg border border-edge bg-surface-base p-3">
              {advanced}
            </div>
          ) : null}
        </div>
      ) : null}
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
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', color)}>
      <Icon className={cn('size-3.5', kind === 'checking' && 'animate-spin')} />
      <span>{label}</span>
      {detail ? <span className="font-normal text-fg-subtle">· {detail}</span> : null}
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
