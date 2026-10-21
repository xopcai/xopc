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
        'chat-composer-surface relative flex min-h-0 w-full flex-col overflow-hidden rounded-2xl shadow-elevated ring-1 ring-inset ring-edge-subtle focus-within:ring-edge dark:shadow-surface',
        dragging && 'ring-2 ring-accent ring-inset',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
