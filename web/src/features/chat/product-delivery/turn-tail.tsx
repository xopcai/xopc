import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function TurnTail({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <section
      className={cn('mt-2 w-full min-w-0 max-w-full self-start', className)}
      aria-label={label}
      data-turn-tail
    >
      <div className="min-w-0">
        {children}
      </div>
    </section>
  );
}
