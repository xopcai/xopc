import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export const assistantCapsuleClassName = 'touch-manipulation inline-flex min-h-11 w-fit max-w-full min-w-0 items-center gap-2 rounded-[1.125rem] bg-surface-inset px-3 py-2 text-left text-sm text-fg transition-colors duration-150 motion-reduce:transition-none hover:bg-surface-hover active:bg-surface-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
export const assistantCapsuleListClassName = 'm-0 flex min-w-0 list-none flex-col items-start gap-2 p-0';
export const assistantCapsuleDetailClassName = 'mt-2 min-w-0 max-w-full rounded-xl bg-surface-inset p-3 text-sm';

export function AssistantCapsuleContent({
  icon,
  title,
  meta,
  trailing,
  fullTitle = false,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  fullTitle?: boolean;
  className?: string;
}) {
  return <>
    <span className="flex size-[18px] shrink-0 items-center justify-center text-accent-fg [&>svg]:size-[18px]" aria-hidden>{icon}</span>
    <span className={cn('min-w-0 break-words text-sm [overflow-wrap:anywhere]', !fullTitle && 'line-clamp-2', className)}>{title}</span>
    {meta ? <span className="flex min-w-0 max-w-40 shrink-0 items-center gap-1.5 text-xs text-fg-muted">
      <span aria-hidden>·</span><span className="line-clamp-2 break-words [overflow-wrap:anywhere]">{meta}</span>
    </span> : null}
    {trailing}
  </>;
}
