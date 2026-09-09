import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function SettingsGroup({
  title,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('min-w-0', className)}>
      {title ? (
        <h2 className="mb-2 px-1 text-xs font-medium text-fg-muted">{title}</h2>
      ) : null}
      <div className="divide-y divide-edge-subtle overflow-hidden rounded-xl border border-edge-subtle bg-surface-base">
        {children}
      </div>
      {footer ? (
        <p className="mt-2 px-1 text-xs leading-5 text-fg-subtle">{footer}</p>
      ) : null}
    </section>
  );
}

export function SettingsRow({
  label,
  detail,
  trailing,
  children,
  className,
  stacked = false,
}: {
  label?: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
  className?: string;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        'px-4 py-3.5 sm:px-5',
        stacked ? 'space-y-3' : 'flex min-h-12 items-center justify-between gap-5',
        className,
      )}
    >
      {label || detail ? (
        <div className="min-w-0 flex-1">
          {label ? <div className="text-sm font-medium text-fg">{label}</div> : null}
          {detail ? <p className="mt-0.5 text-xs leading-5 text-fg-muted">{detail}</p> : null}
        </div>
      ) : null}
      {children}
      {trailing ? <div className="min-w-0 shrink-0">{trailing}</div> : null}
    </div>
  );
}
