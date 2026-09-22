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
      className={cn('relative mt-2 w-full max-w-[28rem] self-start pb-2', className)}
      aria-label={label}
      data-turn-tail
    >
      <div className="relative z-10 overflow-hidden rounded-xl border border-edge bg-surface-inset shadow-surface">
        {children}
      </div>
      <span
        className="absolute bottom-0 left-2.5 h-2.5 w-3 bg-surface-inset [clip-path:polygon(0_0,100%_0,0_100%)]"
        aria-hidden
        data-turn-tail-tip
      />
    </section>
  );
}
