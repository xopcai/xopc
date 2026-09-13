import * as Popover from '@radix-ui/react-popover';
import { SESSION_PURPOSES, SESSION_SOURCES, type SessionPurpose, type SessionSource } from '@xopcai/gateway-contract';
import { ArrowLeft, Check, ChevronRight, MoreHorizontal, Search, Trash2, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { SelectOptionList, type PopoverSelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import { DEFAULT_SESSION_FILTERS, hasSessionFilters, type SessionFilters } from './session-discovery-state';
import { allProjectOptions } from './session-filter-projects';
import { readSavedSessionViews, writeSavedSessionViews } from './session-saved-views';

type Labels = MessageBundle['sidebar']['sessionFilters'];
type FilterPage = 'home' | 'sources' | 'purposes' | 'project' | 'time' | 'status' | 'agent' | 'advanced' | 'views' | 'save';
const quietButton = 'rounded-md px-2 py-1.5 text-xs text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';
const iconButton = 'flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent';

function FilterRow({ label, summary, onClick }: { label: string; summary: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex min-h-10 w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" aria-label={label}>
    <span className="shrink-0">{label}</span>
    <span className="min-w-0 flex-1 truncate text-right text-xs text-fg-muted" title={summary}>{summary}</span>
    <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
  </button>;
}

export function SessionFilterToolbar({ filters, onChange, search, onSearch, labels, gateway, agents }: {
  filters: SessionFilters;
  onChange: (filters: SessionFilters) => void;
  search: string;
  onSearch: (value: string) => void;
  labels: Labels;
  gateway: string;
  agents: Array<{ id: string; name?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<FilterPage>('home');
  const [optionSearch, setOptionSearch] = useState('');
  const [savedViews, setSavedViews] = useState(() => readSavedSessionViews(gateway));
  const [viewName, setViewName] = useState('');
  const [saveError, setSaveError] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastPage = useRef<FilterPage>('home');
  const formId = useId();
  const headingId = useId();
  const selectedView = savedViews.find((view) => view.search === search && JSON.stringify(view.filters) === JSON.stringify(filters));
  const { data: projects, error: projectError, mutate: retryProjects } = useSWR(
    open && page === 'project' || filters.project ? ['session-filter-projects', gateway] : null, allProjectOptions,
  );
  const patch = (value: Partial<SessionFilters>) => onChange({ ...filters, ...value });
  const go = (next: FilterPage) => { setPage(next); setOptionSearch(''); setSaveError(false); };
  const back = () => go(page === 'save' ? 'views' : ['purposes', 'status', 'agent'].includes(page) ? 'advanced' : 'home');
  const setPanelOpen = (value: boolean) => { setOpen(value); if (value) go('home'); };
  // The previous choice is unmounted during drill-down. Move focus into the new page.
  useLayoutEffect(() => {
    if (open && lastPage.current !== page) {
      const target = panelRef.current?.querySelector<HTMLElement>('[data-page-autofocus]');
      target?.focus();
    }
    lastPage.current = page;
  }, [open, page]);

  const custom = hasSessionFilters({ ...filters, activity: '' });
  const count = [filters.sources.length, filters.purposes.length, filters.project, filters.days, filters.agentId, filters.activity, filters.status !== 'visible'].filter(Boolean).length;
  const advancedCount = [filters.purposes.length, filters.agentId, filters.status !== 'visible'].filter(Boolean).length;
  const selectedCount = (n: number) => labels.selectedCount.replace('{{count}}', String(n));
  const sourceSummary = filters.sources.length ? filters.sources.map((source) => labels.sources[source]).join(' · ') : labels.all;
  const purposeSummary = filters.purposes.length ? filters.purposes.map((purpose) => labels.purposes[purpose]).join(' · ') : labels.all;
  const projectSummary = filters.project === '__unassigned' ? labels.unassigned : projects?.find((project) => project.id === filters.project)?.name ?? filters.project;
  const timeSummary = filters.days ? labels.days.replace('{{days}}', filters.days) : labels.anyTime;
  const titles: Record<FilterPage, string> = {
    home: labels.filters, sources: labels.sourcesLabel, purposes: labels.purposesLabel,
    project: labels.project, time: labels.time, status: labels.status, agent: labels.agent,
    advanced: labels.moreFilters, views: labels.savedViews, save: labels.saveView,
  };
  let options: PopoverSelectOption[] | undefined;
  let values: string[] = [];
  let choose: ((values: string[]) => void) | undefined;
  if (page === 'sources') {
    options = SESSION_SOURCES.map((value) => ({ value, label: labels.sources[value] }));
    values = filters.sources;
    choose = (sources) => patch({ sources: sources as SessionSource[] });
  } else if (page === 'purposes') {
    options = SESSION_PURPOSES.map((value) => ({ value, label: labels.purposes[value] }));
    values = filters.purposes;
    choose = (purposes) => patch({ purposes: purposes as SessionPurpose[] });
  } else if (page === 'project') {
    options = [{ value: '', label: labels.allProjects }, { value: '__unassigned', label: labels.unassigned }, ...(projects ?? []).map((project) => ({ value: project.id, label: project.name }))];
    if (filters.project && !options.some((option) => option.value === filters.project)) options.push({ value: filters.project, label: filters.project });
    values = [filters.project];
    choose = ([project]) => { patch({ project }); back(); };
  } else if (page === 'time') {
    options = [{ value: '', label: labels.anyTime }, ...['7', '30', '60'].map((value) => ({ value, label: labels.days.replace('{{days}}', value) }))];
    values = [filters.days];
    choose = ([days]) => { patch({ days }); back(); };
  } else if (page === 'status') {
    options = (['visible', 'pinned', 'archived'] as const).map((value) => ({ value, label: labels[value] }));
    values = [filters.status];
    choose = ([status]) => { patch({ status: status as SessionFilters['status'] }); back(); };
  } else if (page === 'agent') {
    options = [{ value: '', label: labels.allAgents }, ...agents.map((agent) => ({ value: agent.id, label: agent.name || agent.id }))];
    if (filters.agentId && !options.some((option) => option.value === filters.agentId)) options.push({ value: filters.agentId, label: filters.agentId });
    values = [filters.agentId];
    choose = ([agentId]) => { patch({ agentId }); back(); };
  }
  const searchable = page === 'project' || page === 'agent';
  const matchingOptions = options?.filter((option) => option.label.toLocaleLowerCase().includes(optionSearch.trim().toLocaleLowerCase()));
  const clearPage = () => {
    if (page === 'sources') patch({ sources: [] });
    else if (page === 'purposes') patch({ purposes: [] });
    else onChange({ ...DEFAULT_SESSION_FILTERS, details: filters.details });
  };

  return (
    <div className="ml-auto shrink-0">
      <Popover.Root open={open} onOpenChange={setPanelOpen}>
        <Popover.Trigger asChild>
          <button type="button" className={cn(iconButton, 'relative size-6 text-fg-subtle opacity-0 transition-[color,background-color,opacity] group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100', open && 'bg-surface-hover opacity-100')} aria-label={`${labels.filters}${count ? ` (${count})` : ''}`} title={count ? `${labels.filters} · ${selectedCount(count)}` : labels.filters}>
            <MoreHorizontal className="size-3.5" aria-hidden />
            {count > 0 || search.trim() ? <span className="absolute top-0.5 right-0.5 size-1 rounded-full bg-fg-muted" aria-hidden /> : null}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            ref={panelRef} side="bottom" align="start" sideOffset={8} collisionPadding={12} sticky="always"
            aria-labelledby={headingId}
            className="z-50 flex h-[min(26rem,calc(100dvh-1.5rem))] max-h-[var(--radix-popover-content-available-height)] w-[min(20rem,calc(100vw-1.5rem))] max-w-[var(--radix-popover-content-available-width)] flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel text-sm text-fg shadow-popover"
            onEscapeKeyDown={(event) => { if (page !== 'home') { event.preventDefault(); back(); } }}
          >
            <div className="flex shrink-0 items-center gap-1 border-b border-edge px-2 py-2">
              {page !== 'home' ? <button type="button" className={iconButton} aria-label={labels.back} onClick={back} data-page-autofocus={!searchable && page !== 'save' ? '' : undefined}><ArrowLeft className="size-4" aria-hidden /></button> : null}
              <span id={headingId} className="min-w-0 flex-1 truncate px-1 font-medium">{titles[page]}</span>
              <Popover.Close asChild><button type="button" className={iconButton} aria-label={labels.close}><X className="size-4" aria-hidden /></button></Popover.Close>
            </div>
            {searchable ? <div className="shrink-0 px-3 pt-2"><input type="search" data-page-autofocus value={optionSearch} onChange={(event) => setOptionSearch(event.target.value)} placeholder={labels.searchOptions} aria-label={labels.searchOptions} className="w-full rounded-md border border-edge bg-surface-base px-2 py-1.5 text-sm outline-none focus:border-edge-strong focus:ring-1 focus:ring-edge-strong" /></div> : null}
            {page === 'home' ? <div className="shrink-0 px-3 pt-2">
              <label className="flex min-w-0 items-center gap-2 rounded-md border border-edge bg-surface-base px-2 py-1.5 focus-within:border-edge-strong focus-within:ring-1 focus-within:ring-edge-strong">
                <Search className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                <input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder={labels.search} aria-label={labels.search} className="min-w-0 w-full bg-transparent text-sm text-fg outline-none" />
              </label>
            </div> : null}
            <div key={page} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-2" data-session-filter-scroll>
              {page === 'home' ? <>
                <div className="mb-2 flex gap-1 rounded-md bg-surface-base p-1" role="group" aria-label={labels.filters}>
                  {(['', 'manual', 'automatic'] as const).map((activity) => <button key={activity} type="button" data-page-autofocus={activity === '' ? '' : undefined} className={cn(quietButton, 'min-w-0 flex-1 px-1', !custom && filters.activity === activity && 'bg-surface-active text-fg')} aria-pressed={!custom && filters.activity === activity} onClick={() => { onChange({ ...DEFAULT_SESSION_FILTERS, details: filters.details, activity }); setOpen(false); }}>{activity ? labels[activity] : labels.all}</button>)}
                </div>
                <FilterRow label={labels.sourcesLabel} summary={sourceSummary} onClick={() => go('sources')} />
                <FilterRow label={labels.project} summary={projectSummary || labels.allProjects} onClick={() => go('project')} />
                <FilterRow label={labels.time} summary={timeSummary} onClick={() => go('time')} />
                <div className="my-2 border-t border-edge" />
                <FilterRow label={labels.moreFilters} summary={advancedCount ? selectedCount(advancedCount) : ''} onClick={() => go('advanced')} />
                <FilterRow label={labels.savedViews} summary={selectedView?.name ?? (savedViews.length ? String(savedViews.length) : '')} onClick={() => go('views')} />
              </> : null}
              {options && choose ? <>
                <SelectOptionList options={matchingOptions ?? []} values={values} multiple={page === 'sources' || page === 'purposes'} onChange={choose} ariaLabel={titles[page]} />
                {page === 'project' && !projects && !projectError ? <div aria-busy="true" className="space-y-3 p-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-2/3" /></div> : null}
                {page === 'project' && projectError ? <div role="alert" className="p-2 text-xs text-fg-muted"><p>{labels.projectError}</p><button type="button" className={quietButton} onClick={() => void retryProjects()}>{labels.retry}</button></div> : null}
                {!matchingOptions?.length && !(page === 'project' && !projects) ? <p className="p-2 text-xs text-fg-muted">{labels.noOptions}</p> : null}
              </> : null}
              {page === 'advanced' ? <>
                <FilterRow label={labels.purposesLabel} summary={purposeSummary} onClick={() => go('purposes')} />
                <FilterRow label={labels.status} summary={labels[filters.status]} onClick={() => go('status')} />
                {agents.length > 1 || filters.agentId ? <FilterRow label={labels.agent} summary={agents.find((agent) => agent.id === filters.agentId)?.name ?? (filters.agentId || labels.allAgents)} onClick={() => go('agent')} /> : null}
                <label className="mt-2 flex min-h-10 items-center gap-3 border-t border-edge px-2 pt-2 text-sm"><input type="checkbox" checked={filters.details} onChange={(event) => patch({ details: event.target.checked })} />{labels.details}</label>
              </> : null}
              {page === 'views' ? <>
                {!savedViews.length ? <p className="px-2 py-4 text-sm text-fg-muted">{labels.noViews}</p> : null}
                {savedViews.map((view) => <div key={view.id} className="flex min-w-0 items-center gap-1">
                  <button type="button" className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent" onClick={() => { onChange(view.filters); onSearch(view.search); setOpen(false); }} aria-pressed={selectedView?.id === view.id}>
                    <span className="min-w-0 flex-1 truncate" title={view.name}>{view.name}</span>{selectedView?.id === view.id ? <Check className="size-4 shrink-0" aria-hidden /> : null}
                  </button>
                  <button type="button" className={iconButton} aria-label={labels.deleteView.replace('{{name}}', view.name)} onClick={() => { const next = savedViews.filter((item) => item.id !== view.id); if (writeSavedSessionViews(gateway, next)) { setSavedViews(next); setSaveError(false); } else setSaveError(true); }}><Trash2 className="size-3.5" aria-hidden /></button>
                </div>)}
              </> : null}
              {page === 'save' ? <form id={formId} className="space-y-3 p-1" onSubmit={(event) => {
                event.preventDefault();
                const name = viewName.trim();
                if (!name || savedViews.length >= 20) return;
                const next = [...savedViews, { id: crypto.randomUUID(), name, filters, search }];
                if (!writeSavedSessionViews(gateway, next)) { setSaveError(true); return; }
                setSavedViews(next); setViewName(''); go('views');
              }}>
                <label className="block space-y-2 text-sm"><span>{labels.viewName}</span><input data-page-autofocus value={viewName} onChange={(event) => setViewName(event.target.value)} maxLength={60} placeholder={labels.viewName} aria-label={labels.viewName} className="w-full rounded-md border border-edge bg-surface-base px-2 py-2 focus-visible:ring-2 focus-visible:ring-accent" /></label>
                <p className="text-xs text-fg-muted">{labels.saveViewHint}</p>
                {savedViews.length >= 20 ? <p className="text-xs text-fg-muted">{labels.viewLimit}</p> : null}
              </form> : null}
              {saveError ? <p role="alert" className="p-2 text-xs text-danger">{labels.viewSaveError}</p> : null}
            </div>
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-edge px-3 py-2">
              {page === 'home' || page === 'sources' || page === 'purposes'
                ? <button type="button" className={quietButton} disabled={page === 'home' ? !count : !values.length} onClick={clearPage}>{page === 'home' ? labels.clear : labels.clearSelection}</button>
                : page === 'views' ? <button type="button" className={quietButton} disabled={savedViews.length >= 20} onClick={() => go('save')}>{labels.saveView}</button> : <span />}
              {page === 'save' ? <button type="submit" form={formId} className={cn(quietButton, 'bg-surface-active text-fg')} disabled={!viewName.trim() || savedViews.length >= 20}>{labels.saveView}</button>
                : <button type="button" className={cn(quietButton, 'bg-surface-active text-fg')} onClick={() => page === 'home' ? setOpen(false) : back()}>{labels.done}</button>}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
