import { ChevronRight } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

import { cn } from '@/lib/cn';

export function setTaskPanelOpen(params: URLSearchParams, panelId: string, open: boolean): URLSearchParams {
  const next = new URLSearchParams(params);
  const keys = next.getAll('taskPanel').filter((key) => key !== panelId && key !== `${panelId}:closed`);
  next.delete('taskPanel');
  for (const key of keys) next.append('taskPanel', key);
  next.append('taskPanel', open ? panelId : `${panelId}:closed`);
  return next;
}

/** Preserve disclosure state in links and browser history. */
export function TaskDetailDisclosure({ panelId, title, defaultOpen = false, children, summaryClassName, chevron = false, ...props }: Omit<ComponentProps<'details'>, 'open' | 'title'> & {
  panelId: string;
  title: ReactNode;
  defaultOpen?: boolean;
  summaryClassName?: string;
  chevron?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const keys = params.getAll('taskPanel');
  const open = keys.includes(panelId) || (defaultOpen && !keys.includes(`${panelId}:closed`));
  return <details {...props} open={open}>
    <summary className={cn(summaryClassName ?? 'cursor-pointer py-2 text-xs text-fg-muted hover:text-fg',
      chevron && 'flex list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden')} onClick={(event) => {
      event.preventDefault();
      setParams((current) => setTaskPanelOpen(current, panelId, !open), { preventScrollReset: true });
    }}>{chevron ? <>
      <span className="min-w-0 flex-1">{title}</span>
      <ChevronRight aria-hidden className={cn('size-4 shrink-0 text-fg-subtle motion-safe:transition-transform motion-safe:duration-150', open && 'rotate-90')} />
    </> : title}</summary>
    {children}
  </details>;
}
