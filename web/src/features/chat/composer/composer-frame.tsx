import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function ComposerFrame({
  children,
  dragging = false,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  dragging?: boolean;
}) {
  return (
    <div
      className={cn(
        'relative flex min-h-0 w-full flex-col overflow-hidden rounded-2xl bg-surface-panel shadow-surface ring-1 ring-inset ring-edge dark:bg-surface-panel/60 dark:shadow-none',
        dragging && 'ring-2 ring-accent ring-inset',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
