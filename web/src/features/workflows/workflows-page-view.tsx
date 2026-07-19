import { useLayoutEffect, useState } from 'react';
import { ChevronDown, GitBranch, LayoutGrid, ListFilter, Play, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { WorkflowBoard } from './workflow-board';
import { WorkflowPickLibrary } from './workflow-pick-library';
import { WorkflowStatsBar } from './workflow-stats-bar';
import { WorkflowTaskCard } from './workflow-task-card';
import type { WorkflowsPageVm } from './use-workflows-page';
import type { WorkflowDefinition, WorkflowRunSummary } from './workflow-api';
import { filterRunsForBoard } from './workflow-board.utils';
import { resolveWorkflowArgLabel } from './workflow-input.utils';
import { resolveWorkflowLocalizedCopy } from './workflow-meta-locale';
import { WORKFLOW_ARG_FIELDS } from './workflow-page.constants';
import { WorkflowsPageHeaderActions } from './workflows-page-header-actions';
import { Select, SelectOption } from '@/components/ui/popover-select';

type RunSectionId = 'attention' | 'running' | 'queued' | 'recent';
type WorkflowsMessages = ReturnType<typeof messages>['workflows'];

const RUN_SECTIONS: RunSectionId[] = ['attention', 'running', 'queued', 'recent'];
const LAUNCH_TEMPLATE_IDS = [
  'pr_review',
  'implementation_plan',
  'research',
  'debug_incident',
  'meeting_prep',
  'content_draft',
];

function runSectionForStatus(run: WorkflowRunSummary): RunSectionId | null {
  if (run.status === 'failed' || run.status === 'timeout' || run.status === 'cancelled') return 'attention';
  if (run.status === 'running') return 'running';
  if (run.status === 'queued') return 'queued';
  if (run.status === 'succeeded') return 'recent';
  return null;
}

function runTimeMs(run: WorkflowRunSummary): number {
  return run.completedAtMs ?? run.startedAtMs ?? run.createdAtMs;
}

function sortRunsForOperations(section: RunSectionId, runs: WorkflowRunSummary[]): WorkflowRunSummary[] {
  const copy = [...runs];
  if (section === 'queued') return copy.sort((a, b) => a.createdAtMs - b.createdAtMs);
  return copy.sort((a, b) => runTimeMs(b) - runTimeMs(a));
}

function groupRunsForOperations(runs: WorkflowRunSummary[]): Map<RunSectionId, WorkflowRunSummary[]> {
  const grouped = new Map<RunSectionId, WorkflowRunSummary[]>(RUN_SECTIONS.map((section) => [section, []]));
  for (const run of runs) {
    const section = runSectionForStatus(run);
    if (section) grouped.get(section)?.push(run);
  }
  for (const section of RUN_SECTIONS) {
    grouped.set(section, sortRunsForOperations(section, grouped.get(section) ?? []));
  }
  return grouped;
}

function WorkflowTaskCardSkeleton() {
  return (
    <article className="rounded-lg bg-surface-panel p-3 shadow-surface" aria-hidden="true">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-2/3" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
    </article>
  );
}

function pickLaunchDefinitions(definitions: WorkflowDefinition[]): WorkflowDefinition[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const picked: WorkflowDefinition[] = [];
  for (const id of LAUNCH_TEMPLATE_IDS) {
    const definition = byId.get(id);
    if (definition) picked.push(definition);
  }
  for (const definition of definitions) {
    if (picked.length >= 6) break;
    if (!picked.some((item) => item.id === definition.id)) picked.push(definition);
  }
  return picked;
}

function templateInputSummary(definition: WorkflowDefinition, labels: WorkflowsMessages): string {
  const argFields = WORKFLOW_ARG_FIELDS[definition.name] ?? [];
  if (argFields.length > 0) {
    return argFields
      .slice(0, 2)
      .map((field) => resolveWorkflowArgLabel(labels.args, field.labelKey))
      .join(' · ');
  }
  if (definition.inputSchema?.properties && Object.keys(definition.inputSchema.properties).length > 0) {
    return labels.templateInputsStructured;
  }
  return labels.templateInputsGoalOnly;
}

function WorkflowLaunchPanel({
  definitions,
  language,
  labels,
  onStart,
  onDetail,
  onBrowseAll,
  onManageTemplates,
}: {
  definitions: WorkflowDefinition[];
  language: WorkflowsPageVm['language'];
  labels: WorkflowsMessages;
  onStart: (definition: WorkflowDefinition) => void;
  onDetail: (definition: WorkflowDefinition) => void;
  onBrowseAll: () => void;
  onManageTemplates: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const launchDefinitions = pickLaunchDefinitions(definitions);
  if (launchDefinitions.length === 0) return null;

  return (
    <section className="rounded-lg border border-edge-subtle bg-surface-base px-4 py-4 shadow-surface">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <button
          type="button"
          className={cn('flex min-w-0 flex-1 items-start gap-3 text-left', interaction.focusRingPanel)}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <ChevronDown
            className={cn('mt-1 size-4 shrink-0 text-fg-subtle transition-transform', expanded ? 'rotate-180' : null)}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="block text-xs font-medium text-accent-fg">{labels.launchRecommended}</span>
            <span className="mt-1 block text-base font-semibold text-fg">{labels.launchTitle}</span>
            <span className="mt-1 block max-w-3xl text-sm leading-6 text-fg-muted">{labels.launchHint}</span>
          </span>
        </button>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant="secondary" className="h-8 rounded-lg text-xs" onClick={onBrowseAll}>
            {labels.launchBrowseAll}
          </Button>
          <Button type="button" variant="secondary" className="h-8 rounded-lg text-xs" onClick={onManageTemplates}>
            {labels.launchManageTemplates}
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {launchDefinitions.map((definition) => {
            const localized = resolveWorkflowLocalizedCopy(definition, language);
            return (
              <article
                key={definition.id}
                className="relative min-w-0 rounded-lg border border-edge bg-surface-panel p-3 transition-colors hover:bg-surface-hover/45"
              >
                <button
                  type="button"
                  aria-label={`${labels.viewDetails}: ${definition.title}`}
                  className={cn('absolute inset-0 cursor-pointer rounded-lg', interaction.focusRingPanel)}
                  onClick={() => onDetail(definition)}
                />
                <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 text-left">
                    <span className="line-clamp-1 text-sm font-semibold text-fg">{definition.title}</span>
                    <span className="mt-1 block line-clamp-2 text-xs leading-5 text-fg-muted">
                      {localized.whenToUse || localized.description}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="primary"
                    className="pointer-events-auto h-8 shrink-0 rounded-lg px-2.5 text-xs"
                    onClick={() => onStart(definition)}
                  >
                    <Play className="size-3.5" aria-hidden />
                    {labels.runWorkflow}
                  </Button>
                </div>
                <dl className="pointer-events-none relative z-10 mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-md bg-surface-muted/50 px-2.5 py-2">
                    <dt className="font-medium text-fg-subtle">{labels.templateInputs}</dt>
                    <dd className="mt-0.5 line-clamp-1 text-fg-muted">{templateInputSummary(definition, labels)}</dd>
                  </div>
                  <div className="rounded-md bg-surface-muted/50 px-2.5 py-2">
                    <dt className="font-medium text-fg-subtle">{labels.templateExpectedOutput}</dt>
                    <dd className="mt-0.5 line-clamp-1 text-fg-muted">{labels.templateOutputReport}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
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
    ownerAgentId,
    agentOptions,
    setOwnerAgentId,
    workflowFilterId,
    setWorkflowFilterId,
    triggerFilter,
    setTriggerFilter,
    viewMode,
    setViewMode,
    openRunDetails,
    openRunInChat,
    openDefinitionDetails,
    openWorkflowEditor,
    startWorkflow,
    actionError,
    actionFeedback,
    loading,
    error,
    stats,
    cancelRun,
    retryRun,
  } = vm;

  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const nowMs = Date.now();
  const filteredRuns = filterRunsForBoard(runs, { searchQuery, workflowFilterId, triggerFilter });
  const operationGroups = groupRunsForOperations(filteredRuns);

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
            {stats ? `${labels.statsTotalRuns}: ${stats.totalRuns} · ${labels.statsActiveRuns}: ${stats.activeRuns}` : labels.subtitleBoard}
          </p>
        </div>
      ),
      end: <WorkflowsPageHeaderActions vm={vm} />,
    });
    return () => clearPageHeader();
  }, [
    clearPageHeader,
    hasToken,
    labels.title,
    labels.statsActiveRuns,
    labels.statsTotalRuns,
    labels.subtitleBoard,
    loading,
    stats,
    vm,
    vm.refreshAll,
    vm.setSearchQuery,
  ]);

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
      <div className="flex min-h-full w-full flex-col gap-4 px-3 py-5 sm:px-5 xl:px-6">
        <WorkflowLaunchPanel
          definitions={definitions}
          language={language}
          labels={labels}
          onStart={startWorkflow}
          onDetail={openDefinitionDetails}
          onBrowseAll={() => document.getElementById('workflow-library')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          onManageTemplates={() => document.getElementById('workflow-library')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />

        <section className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-edge-subtle bg-surface-base px-3 py-2 shadow-surface">
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={labels.searchPlaceholder}
              className={cn(
                'h-9 w-full rounded-lg border border-edge bg-surface-panel py-2 pl-9 pr-3 text-sm text-fg shadow-surface',
                'placeholder:text-fg-subtle',
                interaction.focusRingPanel,
              )}
            />
          </div>
          {agentOptions.length > 1 ? (
            <Select
              value={ownerAgentId ?? ''}
              aria-label="Agent"
              onChange={(event) => setOwnerAgentId(event.target.value)}
              className={cn(
                'h-9 min-w-32 rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-surface',
                interaction.focusRingPanel,
              )}
            >
              {agentOptions.map((agent) => (
                <SelectOption key={agent.id} value={agent.id}>
                  {agentListDisplayName(agent, messages(language).agentsSettings)}
                </SelectOption>
              ))}
            </Select>
          ) : null}
          <Select
            value={triggerFilter}
            aria-label={labels.boardTriggerFilterAria}
            onChange={(event) => setTriggerFilter(event.target.value)}
            className={cn(
              'h-9 min-w-[7.5rem] rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-surface',
              interaction.focusRingPanel,
            )}
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
            className={cn(
              'h-9 min-w-40 rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-surface',
              interaction.focusRingPanel,
            )}
          >
            <SelectOption value="">{labels.boardWorkflowFilterAll}</SelectOption>
            {definitions.map((definition) => (
              <SelectOption key={definition.id} value={definition.id}>
                {definition.title}
              </SelectOption>
            ))}
          </Select>
          <div className="flex rounded-lg bg-surface-muted p-0.5">
            <button
              type="button"
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                viewMode === 'operations' ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted hover:text-fg',
              )}
              onClick={() => setViewMode('operations')}
            >
              <ListFilter className="size-3.5" aria-hidden />
              {labels.viewModes.operations}
            </button>
            <button
              type="button"
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                viewMode === 'board' ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted hover:text-fg',
              )}
              onClick={() => setViewMode('board')}
            >
              <LayoutGrid className="size-3.5" aria-hidden />
              {labels.viewModes.board}
            </button>
          </div>
        </section>

        {actionFeedback ? (
          <div className="w-full rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
            {actionFeedback}
          </div>
        ) : null}

        {(actionError ?? error) ? (
          <div className="w-full rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {actionError ?? error}
          </div>
        ) : null}

        <section className="grid w-full gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label={labels.subtitleBoard}>
          {RUN_SECTIONS.map((section) => {
            const count = operationGroups.get(section)?.length ?? 0;
            return (
              <button
                key={section}
                type="button"
                className={cn(
                  'min-w-0 rounded-lg border border-edge-subtle bg-surface-base px-3 py-2 text-left shadow-surface',
                  'hover:bg-surface-hover/45',
                  interaction.focusRingPanel,
                )}
                onClick={() => setViewMode('operations')}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-xs font-medium text-fg-muted">
                    {labels.operationSections[section].title}
                  </span>
                  <span className="font-mono text-sm font-semibold tabular-nums text-fg">{count}</span>
                </div>
                <p className="mt-1 truncate text-xs text-fg-subtle">
                  {labels.operationSections[section].description}
                </p>
              </button>
            );
          })}
        </section>

        <div className="w-full">
          <WorkflowStatsBar stats={stats} language={language} />
        </div>

        {viewMode === 'operations' ? (
          <div className="pb-3">
            <div className="grid w-full gap-4">
              {RUN_SECTIONS.map((section) => {
                const sectionRuns = operationGroups.get(section) ?? [];
                return (
                  <section key={section} className="rounded-lg border border-edge-subtle bg-surface-base shadow-surface">
                    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-edge-subtle px-4 py-3">
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-fg">{labels.operationSections[section].title}</h2>
                        <p className="mt-1 text-xs text-fg-muted">{labels.operationSections[section].description}</p>
                      </div>
                      <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs font-semibold tabular-nums text-fg-muted">
                        {sectionRuns.length}
                      </span>
                    </header>
                    <div className="grid gap-2 p-2.5 md:grid-cols-2 xl:grid-cols-3">
                      {loading && sectionRuns.length === 0
                        ? Array.from({ length: 3 }).map((_, i) => <WorkflowTaskCardSkeleton key={i} />)
                        : sectionRuns.map((run) => (
                            <WorkflowTaskCard
                              key={run.id}
                              run={run}
                              language={language}
                              localeTag={localeTag}
                              nowMs={nowMs}
                              selected={false}
                              onOpen={openRunDetails}
                              onOpenChat={openRunInChat}
                              onCancel={(runId) => void cancelRun(runId)}
                              onRetry={(runId) => void retryRun(runId)}
                            />
                          ))}
                      {!loading && sectionRuns.length === 0 ? (
                        <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-edge bg-surface-panel/40 px-4 py-5 text-center text-xs text-fg-subtle md:col-span-2 xl:col-span-3">
                          {labels.operationSections[section].empty}
                        </div>
                      ) : null}
                    </div>
                  </section>
                );
              })}

            </div>
          </div>
        ) : (
          <div className="h-[min(72vh,48rem)] min-h-[24rem] w-full sm:min-h-[28rem]">
            <WorkflowBoard
              runs={runs}
              language={language}
              localeTag={localeTag}
              labels={{
                boardEmptyTitle: labels.boardEmptyTitle,
                boardEmptyHint: labels.boardEmptyHint,
                boardStart: labels.boardStart,
                loading: labels.loading,
              }}
              searchQuery={searchQuery}
              workflowFilterId={workflowFilterId}
              triggerFilter={triggerFilter}
              selectedRunId={null}
              loading={loading}
              onOpenRun={openRunDetails}
              onOpenRunChat={openRunInChat}
              onCancelRun={(runId) => void cancelRun(runId)}
              onRetryRun={(runId) => void retryRun(runId)}
              onStart={() => document.getElementById('workflow-library')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            />
          </div>
        )}

        <section id="workflow-library" className="scroll-mt-4 border-t border-edge pt-6">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-fg">{language === 'zh' ? '全部工作流' : 'All workflows'}</h2>
            <p className="mt-1 text-sm text-fg-muted">{language === 'zh' ? '点击卡片进入详情，了解步骤、输入和最近运行。' : 'Select a card to see its steps, inputs, and recent runs.'}</p>
          </div>
          <WorkflowPickLibrary
            definitions={definitions}
            language={language}
            onPick={startWorkflow}
            onDetail={openDefinitionDetails}
            onEdit={openWorkflowEditor}
          />
        </section>
      </div>
    </main>
  );
}
