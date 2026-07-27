import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function SettingsPageFrame({
  children,
  className,
  gap = 'gap-4',
  padding = 'px-3 py-6 sm:px-5 xl:px-6',
  ...props
}: {
  children: ReactNode;
  className?: string;
  gap?: string;
  padding?: string;
} & ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn(
        'flex min-h-full w-full flex-col bg-surface-panel',
        gap,
        padding,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
