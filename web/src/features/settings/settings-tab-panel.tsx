import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function SettingsTabPanel<T extends string>({
  id,
  activeTab,
  tabIdPrefix,
  panelIdPrefix,
  title,
  hint,
  showHeading = true,
  framed = true,
  children,
  className,
}: {
  id: T;
  activeTab: T;
  tabIdPrefix: string;
  panelIdPrefix: string;
  title?: ReactNode;
  hint?: ReactNode;
  showHeading?: boolean;
  framed?: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (activeTab !== id) return null;

  return (
    <section
      id={`${panelIdPrefix}-${id}`}
      role="tabpanel"
      aria-labelledby={`${tabIdPrefix}-${id}`}
      className={cn(
        'min-w-0',
        framed &&
          'rounded-2xl border border-edge-subtle bg-surface-base px-4 py-5 sm:px-5',
        className,
      )}
    >
      {showHeading && (title || hint) ? (
        <div className="mb-5">
          {title ? (
            <div className="text-sm font-semibold text-fg">{title}</div>
          ) : null}
          {hint ? (
            <p className="mt-1 text-xs text-fg-subtle">{hint}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
