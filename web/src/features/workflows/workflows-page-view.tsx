import { useLayoutEffect, useState } from 'react';
import { GitBranch, LayoutGrid, ListFilter, Search } from 'lucide-react';

import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { WorkflowBoard } from './workflow-board';
import { WorkflowCreateDialog } from './workflow-create-dialog';
import { WorkflowDefinitionDetailDialog } from './workflow-definition-detail-dialog';
import { WorkflowPickStartDialog } from './workflow-pick-start-dialog';
import { WorkflowRunPanel } from './workflow-run-panel';
import { WorkflowStartDialog } from './workflow-start-dialog';
import { WorkflowStatsBar } from './workflow-stats-bar';
import { WorkflowTaskCard } from './workflow-task-card';
import type { WorkflowsPageVm } from './use-workflows-page';
import type { WorkflowRunSummary } from './workflow-api';
import { filterRunsForBoard } from './workflow-board.utils';
import { WorkflowsPageHeaderActions } from './workflows-page-header-actions';
import { Select, SelectOption } from '@/components/ui/popover-select';

type WorkflowsViewMode = 'operations' | 'board';
type RunSectionId = 'attention' | 'running' | 'queued' | 'recent';

const RUN_SECTIONS: RunSectionId[] = ['attention', 'running', 'queued', 'recent'];

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
    selectedRunId,
    selectedRunView,
    selectedRunComparison,
    selectedRunLoading,
    selectedRunError,
    openRunDetails,
    closeRunDetails,
    openRunDetailsById,
    openRunInChat,
    pickStartOpen,
    setPickStartOpen,
    startDefinition,
    setStartDefinition,
    detailDefinition,
    setDetailDefinition,
    manageOpen,
    setManageOpen,
    workflowEditorDraft,
    openWorkflowEditor,
    actionError,
    actionFeedback,
    starting,
    savingWorkflow,
    loading,
    error,
    stats,
    submitStart,
    cancelRun,
    retryRun,
    replayRun,
    saveCustomWorkflow,
    saveDraftAndStart,
  } = vm;

  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const [viewMode, setViewMode] = useState<WorkflowsViewMode>('operations');
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
    vm.setManageOpen,
    vm.setSearchQuery,
  ]);

  if (!hasToken) {
    return (
      <main className="min-h-0 flex-1 overflow-auto bg-surface-base">
        <div className="flex w-full flex-col items-center px-3 py-16 text-center sm:px-5 xl:px-6">
          <GitBranch className="size-10 text-accent-fg" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold text-fg">{labels.title}</h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-fg-muted">{labels.needToken}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-base">
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4 px-3 py-5 sm:px-5 xl:px-6">
        <section className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface-panel/70 px-3 py-2">
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
          <div className="flex rounded-lg border border-edge bg-surface-muted p-0.5">
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

        <div className="w-full">
          <WorkflowStatsBar stats={stats} language={language} />
        </div>

        {selectedRunError ? (
          <div className="w-full rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            {selectedRunError}
          </div>
        ) : null}

        {viewMode === 'operations' ? (
          <div className="min-h-0 flex-1 overflow-y-auto pb-3">
            <div className="grid w-full gap-4">
              {RUN_SECTIONS.map((section) => {
                const sectionRuns = operationGroups.get(section) ?? [];
                return (
                  <section key={section} className="rounded-lg border border-edge bg-surface-panel/60">
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
                      {sectionRuns.map((run) => (
                        <WorkflowTaskCard
                          key={run.id}
                          run={run}
                          language={language}
                          localeTag={localeTag}
                          nowMs={nowMs}
                          selected={run.id === selectedRunId}
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
          <div className="min-h-0 w-full flex-1">
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
              selectedRunId={selectedRunId}
              loading={loading}
              onOpenRun={openRunDetails}
              onOpenRunChat={openRunInChat}
              onCancelRun={(runId) => void cancelRun(runId)}
              onRetryRun={(runId) => void retryRun(runId)}
              onStart={() => setPickStartOpen(true)}
            />
          </div>
        )}
      </div>

      <WorkflowRunPanel
        view={selectedRunView}
        comparison={selectedRunComparison}
        currentDefinition={definitions.find((definition) => definition.id === selectedRunView?.run.definitionId)}
        loading={Boolean(selectedRunId) && selectedRunLoading}
        language={language}
        localeTag={localeTag}
        onCancel={() => {
          if (selectedRunId) void cancelRun(selectedRunId);
        }}
        onRetry={() => {
          if (selectedRunId) void retryRun(selectedRunId);
        }}
        onReplay={(scope) => {
          if (selectedRunId) void replayRun(selectedRunId, scope);
        }}
        onOpenRunId={openRunDetailsById}
        ownerAgentId={ownerAgentId}
        onClose={closeRunDetails}
      />

      <WorkflowPickStartDialog
        open={pickStartOpen}
        definitions={definitions}
        language={language}
        onClose={() => setPickStartOpen(false)}
        onPick={(definition) => {
          setPickStartOpen(false);
          setStartDefinition(definition);
        }}
        onDetail={(definition) => {
          setPickStartOpen(false);
          setDetailDefinition(definition);
        }}
        onEdit={openWorkflowEditor}
      />

      <WorkflowStartDialog
        open={startDefinition != null}
        definition={startDefinition}
        language={language}
        starting={starting}
        onClose={() => setStartDefinition(null)}
        onStart={(payload) => void submitStart(payload)}
      />

      <WorkflowDefinitionDetailDialog
        open={detailDefinition != null}
        definition={detailDefinition}
        language={language}
        onClose={() => setDetailDefinition(null)}
        onRun={() => {
          if (!detailDefinition) return;
          setDetailDefinition(null);
          setStartDefinition(detailDefinition);
        }}
      />

      <WorkflowCreateDialog
        open={manageOpen}
        language={language}
        ownerAgentId={ownerAgentId}
        saving={savingWorkflow}
        initialDraft={
          workflowEditorDraft
            ? {
                mode: workflowEditorDraft.mode,
                name: workflowEditorDraft.initialName,
                script: workflowEditorDraft.initialScript,
                sourceTitle: workflowEditorDraft.definition.title,
              }
            : null
        }
        onClose={() => setManageOpen(false)}
        onSave={(payload) => saveCustomWorkflow(payload)}
        onSaveAndStart={saveDraftAndStart}
      />
    </main>
  );
}
