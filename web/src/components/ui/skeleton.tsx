import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-hover/70 motion-reduce:animate-none', className)}
      {...props}
    />
  );
}
