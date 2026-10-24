import { ChevronDown } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Local disclosure state stays independent of the global settings mode. */
export function BrowserSettingsDisclosure({ name, title, summary, icon, inset = false, children }: {
  name: string; title: string; summary?: string; icon?: ReactNode; inset?: boolean; children: ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const contentId = useId();
  const key = `browser-${name}`;
  const open = params.get(key) === '1';
  return <section className={inset ? 'border-t border-edge-subtle' : 'rounded-2xl border border-edge bg-surface-panel'}>
    <h2><button type="button" aria-expanded={open} aria-controls={contentId}
      className="flex min-h-16 w-full items-center gap-3 rounded-2xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:p-5"
      onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set(key, open ? '0' : '1'); return next; })}>
      {icon && <span className="shrink-0 text-fg-muted" aria-hidden>{icon}</span>}
      <span className="min-w-0 flex-1 text-sm font-semibold text-fg">{title}</span>
      {summary && <span className="max-w-[40%] truncate text-xs font-normal text-fg-muted" title={summary}>{summary}</span>}
      <ChevronDown className={`size-4 shrink-0 text-fg-muted ${open ? 'rotate-180' : ''}`} aria-hidden />
    </button></h2>
    <div id={contentId} hidden={!open} className="space-y-4 border-t border-edge-subtle p-4 sm:p-5">{open && children}</div>
  </section>;
}
