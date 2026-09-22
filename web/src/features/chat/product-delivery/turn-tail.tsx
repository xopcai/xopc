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
      className={cn('mt-2 w-full max-w-[28rem] self-start', className)}
      aria-label={label}
      data-turn-tail
    >
      <div className="overflow-hidden rounded-xl border border-edge bg-surface-inset shadow-surface">
        {children}
      </div>
    </section>
  );
}
