import {
  Content as TooltipContent,
  Portal as TooltipPortal,
  Provider as TooltipProvider,
  Root as TooltipRoot,
  Trigger as TooltipTrigger,
} from '@radix-ui/react-tooltip';
import { Check, ChevronDown, Link2, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export type DependencyCandidate = { id: string; title: string };

export type DependencyPickerLabels = {
  link: string;
  linked: string;
  searchPlaceholder: string;
  noMatches: string;
  noCandidates: string;
  remove: string;
};

const taskTitleTooltipClass =
  '!z-[10000] max-w-[min(28rem,90vw)] rounded-md border border-edge bg-surface-panel px-2.5 py-2 text-left text-xs leading-relaxed text-fg shadow-lg';

export function DependencyPicker({ candidates, selectedIds, labels, disabled, borderless = false, onChange }: {
  candidates: DependencyCandidate[];
  selectedIds: string[];
  labels: DependencyPickerLabels;
  disabled?: boolean;
  borderless?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = useMemo(() => candidates
    .filter((task) => !normalizedQuery || task.title.toLocaleLowerCase().includes(normalizedQuery))
    .slice(0, 20), [candidates, normalizedQuery]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-w-0 grid gap-2">
        {selectedIds.length > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-2">
            {selectedIds.map((taskId) => {
              const task = candidates.find((candidate) => candidate.id === taskId);
              if (!task) return null;
              return (
                <span key={task.id} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs text-accent-fg">
                  <TooltipRoot>
                    <TooltipTrigger asChild>
                      <span className="min-w-0 truncate">{task.title}</span>
                    </TooltipTrigger>
                    <TooltipPortal>
                      <TooltipContent side="top" sideOffset={6} collisionPadding={12} className={taskTitleTooltipClass}>
                        <span className="break-words">{task.title}</span>
                      </TooltipContent>
                    </TooltipPortal>
                  </TooltipRoot>
                  <button
                    type="button"
                    className="shrink-0 rounded text-accent-fg/70 hover:text-accent-fg"
                    aria-label={labels.remove.replace('{{task}}', task.title)}
                    disabled={disabled}
                    onClick={() => onChange(selectedIds.filter((id) => id !== task.id))}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}
        {candidates.length > 0 ? (
          <>
            <Button
              type="button"
              variant="secondary"
              className={cn('w-fit rounded-lg', borderless && 'border-0 bg-surface-hover shadow-none')}
              disabled={disabled}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <Link2 className="size-4" aria-hidden />
              {selectedIds.length > 0
                ? labels.linked.replace('{{count}}', String(selectedIds.length))
                : labels.link}
              <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
            </Button>
            {open ? (
              <div className={cn('grid gap-2 rounded-lg p-2', borderless ? 'bg-surface-hover' : 'border border-edge bg-surface-base')}>
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={labels.searchPlaceholder}
                    className={cn('h-9 w-full rounded-md bg-surface-panel pl-8 pr-3 text-sm text-fg outline-none placeholder:text-fg-subtle', borderless ? 'focus:ring-2 focus:ring-accent/30' : 'border border-edge focus:border-accent')}
                    autoFocus
                  />
                </label>
                {matches.length > 0 ? (
                  <div className="grid max-h-52 gap-1 overflow-y-auto">
                    {matches.map((task) => {
                      const selected = selectedIds.includes(task.id);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          aria-pressed={selected}
                          disabled={disabled}
                          onClick={() => onChange(selected
                            ? selectedIds.filter((id) => id !== task.id)
                            : [...selectedIds, task.id])}
                          className={cn(
                            'flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                            selected ? 'bg-accent-soft text-accent-fg' : 'text-fg hover:bg-surface-hover',
                          )}
                        >
                          <span className={cn('flex size-4 shrink-0 items-center justify-center rounded', borderless ? (selected ? 'bg-accent text-white' : 'bg-surface-active') : (selected ? 'border border-accent bg-accent text-white' : 'border border-edge'))}>
                            {selected ? <Check className="size-3" aria-hidden /> : null}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{task.title}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : <p className="px-2 py-3 text-center text-sm text-fg-subtle">{labels.noMatches}</p>}
              </div>
            ) : null}
          </>
        ) : <p className="text-sm text-fg-subtle">{labels.noCandidates}</p>}
      </div>
    </TooltipProvider>
  );
}
