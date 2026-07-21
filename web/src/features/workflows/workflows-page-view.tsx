import { useLayoutEffect, type KeyboardEvent } from 'react';
import { AlertTriangle, GitBranch, LayoutGrid, Library, List, ListChecks, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { usePageHeaderStore } from '@/stores/page-header-store';

import type { WorkflowsPageVm } from './use-workflows-page';
import type { WorkflowRunSummary } from './workflow-api';
import { WorkflowBoard } from './workflow-board';
import {
  filterRunsForBoard,
  formatRelativeTime,
  resolveRunCardTitle,
} from './workflow-board.utils';
import { WorkflowPickLibrary } from './workflow-pick-library';
import type { WorkflowStatusFilter } from './workflow-page.constants';
import { WorkflowRunRow } from './workflow-run-row';
import { WorkflowsPageHeaderActions } from './workflows-page-header-actions';

const ATTENTION_STATUSES = new Set(['failed', 'timeout', 'cancelled']);
const PAGE_TABS = [
  { id: 'runs', icon: ListChecks },
  { id: 'library', icon: Library },
] as const;
type PageTab = (typeof PAGE_TABS)[number]['id'];

const RUN_PRIORITY: Record<string, number> = {
  failed: 0,
  timeout: 0,
  cancelled: 0,
  running: 1,
  queued: 2,
  succeeded: 3,
};

function isAttentionRun(run: WorkflowRunSummary): boolean {
  return ATTENTION_STATUSES.has(run.status);
}

function matchesStatusFilter(run: WorkflowRunSummary, filter: WorkflowStatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'attention') return isAttentionRun(run);
  return run.status === filter;
}

function sortRuns(runs: WorkflowRunSummary[]): WorkflowRunSummary[] {
  return [...runs].sort((a, b) => {
    const priorityDelta = (RUN_PRIORITY[a.status] ?? 4) - (RUN_PRIORITY[b.status] ?? 4);
    if (priorityDelta !== 0) return priorityDelta;
    if (a.status === 'queued' && b.status === 'queued') return a.createdAtMs - b.createdAtMs;
    const aTime = a.completedAtMs ?? a.startedAtMs ?? a.createdAtMs;
    const bTime = b.completedAtMs ?? b.startedAtMs ?? b.createdAtMs;
    return bTime - aTime;
  });
}

function getPageTabFromKey(key: string, currentTab: PageTab): PageTab | null {
  if (key === 'Home') return 'runs';
  if (key === 'End') return 'library';
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    return currentTab === 'runs' ? 'library' : 'runs';
  }
  return null;
}

function WorkflowRunRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-edge-subtle px-4 py-4 last:border-b-0" aria-hidden="true">
      <Skeleton className="h-5 w-16 rounded-full" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-52 max-w-full" />
        <Skeleton className="mt-2 h-3 w-36 max-w-full" />
      </div>
      <Skeleton className="hidden h-8 w-20 rounded-lg sm:block" />
    </div>
  );
}

export function WorkflowsPageView({ vm }: { vm: WorkflowsPageVm }) {
  const {
    language,
    localeTag,
    labels,
    hasToken,
    definitions,
    runs,
    searchQuery,
    setSearchQuery,
    workflowFilterId,
    setWorkflowFilterId,
    triggerFilter,
    setTriggerFilter,
    statusFilter,
    setStatusFilter,
    clearRunFilters,
    pageTab,
    setPageTab,
    runLayout,
    setRunLayout,
    openRunDetails,
    openRunInChat,
    openDefinitionDetails,
    openWorkflowEditor,
    startWorkflow,
    actionError,
    loading,
    error,
    cancelRun,
    retryRun,
  } = vm;

  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const nowMs = Date.now();
  const attentionRuns = sortRuns(runs.filter(isAttentionRun));
  const filteredRuns = sortRuns(
    filterRunsForBoard(runs, { searchQuery, workflowFilterId, triggerFilter })
      .filter((run) => matchesStatusFilter(run, statusFilter)),
  );
  const hasRunFilters = Boolean(searchQuery || workflowFilterId || triggerFilter !== 'all' || statusFilter !== 'all');

  useLayoutEffect(() => {
    if (!hasToken) {
      clearPageHeader();
      return;
    }
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{labels.title}</h1>
          <p className="truncate text-xs text-fg-muted">
            {pageTab === 'runs' ? labels.runsSubtitle : labels.librarySubtitle}
          </p>
        </div>
      ),
      end: <WorkflowsPageHeaderActions vm={vm} />,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, hasToken, labels.librarySubtitle, labels.runsSubtitle, labels.title, pageTab, setPageHeader, vm]);

  if (!hasToken) {
    return (
      <main className="min-h-0 flex-1 overflow-auto bg-surface-panel">
        <div className="flex w-full flex-col items-center px-3 py-16 text-center sm:px-5 xl:px-6">
          <GitBranch className="size-10 text-accent-fg" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold text-fg">{labels.title}</h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-fg-muted">{labels.needToken}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-surface-panel">
      <div className="mx-auto flex min-h-full w-full max-w-[96rem] flex-col px-3 py-5 sm:px-5 xl:px-6">
        <nav
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
          aria-label={labels.pageTabsAria}
          role="tablist"
        >
          {PAGE_TABS.map(({ id: tab, icon: Icon }) => (
            <button
              key={tab}
              id={`workflow-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={pageTab === tab}
              aria-controls={`workflow-panel-${tab}`}
              tabIndex={pageTab === tab ? 0 : -1}
              draggable={false}
              className={cn(
                'relative inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium',
                'transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                pageTab === tab
                  ? 'bg-accent-soft text-accent-fg'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
              onClick={() => setPageTab(tab)}
              onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                const nextTab = getPageTabFromKey(event.key, tab);
                if (!nextTab) return;
                event.preventDefault();
                setPageTab(nextTab);
                window.requestAnimationFrame(() => {
                  document.getElementById(`workflow-tab-${nextTab}`)?.focus();
                });
              }}
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              <span>{labels.pageTabs[tab]}</span>
              {tab === 'runs' && attentionRuns.length > 0 ? (
                <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                  {attentionRuns.length}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        {(actionError ?? error) ? (
          <div className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300" role="alert">
            {actionError ?? error}
          </div>
        ) : null}

        {pageTab === 'runs' ? (
          <div
            id="workflow-panel-runs"
            role="tabpanel"
            aria-labelledby="workflow-tab-runs"
            className="flex flex-col gap-4 py-4"
          >
            {attentionRuns.length > 0 ? (
              <section className="rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3" aria-labelledby="workflow-attention-heading">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 id="workflow-attention-heading" className="text-sm font-semibold text-fg">{labels.attentionTitle}</h2>
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                          {attentionRuns.length}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-fg-muted">
                        {resolveRunCardTitle(attentionRuns[0])} · {formatRelativeTime(attentionRuns[0].completedAtMs ?? attentionRuns[0].createdAtMs, nowMs, localeTag)}
                      </p>
                      <p className="mt-1 text-xs text-fg-subtle">{labels.attentionHint}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 pl-7 lg:pl-0">
                    <Button type="button" variant="secondary" className="h-8 rounded-lg text-xs" onClick={() => openRunDetails(attentionRuns[0])}>
                      {labels.attentionView}
                    </Button>
                    <Button type="button" variant="primary" className="h-8 rounded-lg text-xs" onClick={() => void retryRun(attentionRuns[0].id)}>
                      {labels.rerun}
                    </Button>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="flex flex-col gap-3 rounded-xl border border-edge-subtle bg-surface-base px-3 py-3" aria-label={labels.runFiltersAria}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-52 flex-1 sm:max-w-sm">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={labels.runsSearchPlaceholder}
                    className={cn(
                      'h-9 w-full rounded-lg border border-edge bg-surface-panel py-2 pl-9 pr-3 text-sm text-fg shadow-surface',
                      'placeholder:text-fg-muted',
                      interaction.focusRingPanel,
                    )}
                  />
                </div>
                <Select
                  value={statusFilter}
                  aria-label={labels.statusFilterAria}
                  onChange={(event) => setStatusFilter(event.target.value as WorkflowStatusFilter)}
                  className="h-9 min-w-32 rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-surface"
                >
                  {(['all', 'attention', 'running', 'queued', 'succeeded'] as const).map((status) => (
                    <SelectOption key={status} value={status}>{labels.runStatuses[status]}</SelectOption>
                  ))}
                </Select>
                <Select
                  value={triggerFilter}
                  aria-label={labels.boardTriggerFilterAria}
                  onChange={(event) => setTriggerFilter(event.target.value)}
                  className="h-9 min-w-[7.5rem] rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-surface"
                >
                  <SelectOption value="all">{labels.boardTriggerFilterAll}</SelectOption>
                  <SelectOption value="automation">{labels.boardTriggerFilterAutomation}</SelectOption>
                  <SelectOption value="webui">{labels.boardTriggerFilterWebui}</SelectOption>
                  <SelectOption value="chat">{labels.boardTriggerFilterChat}</SelectOption>
                  <SelectOption value="api">{labels.boardTriggerFilterApi}</SelectOption>
                </Select>
                <Select
                  value={workflowFilterId}
                  aria-label={labels.boardWorkflowFilterAria}
                  onChange={(event) => setWorkflowFilterId(event.target.value)}
                  className="h-9 min-w-40 rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-surface"
                >
                  <SelectOption value="">{labels.boardWorkflowFilterAll}</SelectOption>
                  {definitions.map((definition) => (
                    <SelectOption key={definition.id} value={definition.id}>{definition.title}</SelectOption>
                  ))}
                </Select>
                {hasRunFilters ? (
                  <Button type="button" variant="ghost" className="h-9 rounded-lg text-xs" onClick={clearRunFilters}>
                    <X className="size-3.5" aria-hidden />
                    {labels.clearFilters}
                  </Button>
                ) : null}
                <div className="ml-auto flex rounded-lg bg-surface-muted p-0.5" role="group" aria-label={labels.layoutAria}>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                      runLayout === 'list' ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted hover:text-fg',
                      interaction.focusRingPanel,
                    )}
                    aria-pressed={runLayout === 'list'}
                    onClick={() => setRunLayout('list')}
                  >
                    <List className="size-3.5" aria-hidden />
                    {labels.runLayouts.list}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                      runLayout === 'board' ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted hover:text-fg',
                      interaction.focusRingPanel,
                    )}
                    aria-pressed={runLayout === 'board'}
                    onClick={() => setRunLayout('board')}
                  >
                    <LayoutGrid className="size-3.5" aria-hidden />
                    {labels.runLayouts.board}
                  </button>
                </div>
              </div>
            </section>

            {runLayout === 'list' ? (
              <section className="overflow-hidden rounded-xl border border-edge-subtle bg-surface-base" aria-labelledby="workflow-runs-heading">
                <header className="flex items-start justify-between gap-3 border-b border-edge-subtle px-4 py-3">
                  <div>
                    <h2 id="workflow-runs-heading" className="text-sm font-semibold text-fg">{labels.allRuns}</h2>
                    <p className="mt-1 text-xs text-fg-muted">{labels.allRunsHint}</p>
                  </div>
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-fg-muted">{filteredRuns.length}</span>
                </header>
                {loading && filteredRuns.length === 0 ? (
                  Array.from({ length: 4 }).map((_, index) => <WorkflowRunRowSkeleton key={index} />)
                ) : filteredRuns.length > 0 ? (
                  filteredRuns.map((run) => (
                    <WorkflowRunRow
                      key={run.id}
                      run={run}
                      language={language}
                      localeTag={localeTag}
                      nowMs={nowMs}
                      onOpen={openRunDetails}
                      onOpenChat={openRunInChat}
                      onCancel={(runId) => void cancelRun(runId)}
                      onRetry={(runId) => void retryRun(runId)}
                    />
                  ))
                ) : (
                  <div className="flex min-h-64 flex-col items-center justify-center px-4 py-12 text-center">
                    <GitBranch className="size-8 text-fg-subtle" aria-hidden />
                    <h3 className="mt-3 text-sm font-semibold text-fg">
                      {hasRunFilters ? labels.noRunResultsTitle : labels.noRunsTitle}
                    </h3>
                    <p className="mt-1 max-w-md text-xs leading-5 text-fg-muted">
                      {hasRunFilters ? labels.noRunResultsHint : labels.noRunsStartHint}
                    </p>
                    <Button
                      type="button"
                      variant={hasRunFilters ? 'secondary' : 'primary'}
                      className="mt-4 h-9 rounded-lg text-xs"
                      onClick={hasRunFilters ? clearRunFilters : () => setPageTab('library')}
                    >
                      {hasRunFilters ? labels.clearFilters : labels.chooseWorkflow}
                    </Button>
                  </div>
                )}
              </section>
            ) : (
              <div className="h-[min(72vh,48rem)] min-h-[24rem] w-full sm:min-h-[28rem]">
                <WorkflowBoard
                  runs={filteredRuns}
                  language={language}
                  localeTag={localeTag}
                  labels={{
                    boardEmptyTitle: labels.boardEmptyTitle,
                    boardEmptyHint: labels.boardEmptyHint,
                    boardStart: labels.chooseWorkflow,
                    loading: labels.loading,
                  }}
                  searchQuery=""
                  workflowFilterId=""
                  triggerFilter="all"
                  selectedRunId={null}
                  loading={loading}
                  onOpenRun={openRunDetails}
                  onOpenRunChat={openRunInChat}
                  onCancelRun={(runId) => void cancelRun(runId)}
                  onRetryRun={(runId) => void retryRun(runId)}
                  onStart={() => setPageTab('library')}
                />
              </div>
            )}
          </div>
        ) : (
          <section
            id="workflow-panel-library"
            role="tabpanel"
            aria-labelledby="workflow-tab-library"
            className="py-5"
          >
            <div className="mb-5">
              <h2 id="workflow-library-heading" className="text-base font-semibold text-fg">{labels.libraryTitle}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">{labels.libraryDescription}</p>
            </div>
            <WorkflowPickLibrary
              definitions={definitions}
              runs={runs}
              language={language}
              onPick={startWorkflow}
              onDetail={openDefinitionDetails}
              onEdit={openWorkflowEditor}
            />
          </section>
        )}
      </div>
    </main>
  );
}
