import type { ComponentProps, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

export function setTaskPanelOpen(params: URLSearchParams, panelId: string, open: boolean): URLSearchParams {
  const next = new URLSearchParams(params);
  const keys = next.getAll('taskPanel').filter((key) => key !== panelId && key !== `${panelId}:closed`);
  next.delete('taskPanel');
  for (const key of keys) next.append('taskPanel', key);
  next.append('taskPanel', open ? panelId : `${panelId}:closed`);
  return next;
}

/** Preserve disclosure state in links and browser history. */
export function TaskDetailDisclosure({ panelId, title, defaultOpen = false, children, summaryClassName, ...props }: Omit<ComponentProps<'details'>, 'open' | 'title'> & {
  panelId: string;
  title: ReactNode;
  defaultOpen?: boolean;
  summaryClassName?: string;
}) {
  const [params, setParams] = useSearchParams();
  const keys = params.getAll('taskPanel');
  const open = keys.includes(panelId) || (defaultOpen && !keys.includes(`${panelId}:closed`));
  return <details {...props} open={open}>
    <summary className={summaryClassName ?? 'cursor-pointer py-2 text-xs text-fg-muted hover:text-fg'} onClick={(event) => {
      event.preventDefault();
      setParams((current) => setTaskPanelOpen(current, panelId, !open), { preventScrollReset: true });
    }}>{title}</summary>
    {children}
  </details>;
}
