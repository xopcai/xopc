import { useLayoutEffect } from 'react';
import { GitBranch, Search } from 'lucide-react';

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
import type { WorkflowsPageVm } from './use-workflows-page';
import { WorkflowsPageHeaderActions } from './workflows-page-header-actions';

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
        <div className="mx-auto flex w-full max-w-app-main flex-col items-center px-4 py-16 text-center sm:px-8">
          <GitBranch className="size-10 text-accent-fg" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold text-fg">{labels.title}</h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-fg-muted">{labels.needToken}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-base">
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4 px-4 py-5 sm:px-6 2xl:px-8">
        <section className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface-panel/70 px-3 py-2">
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
            <select
              value={ownerAgentId ?? ''}
              aria-label="Agent"
              onChange={(event) => setOwnerAgentId(event.target.value)}
              className={cn(
                'h-9 min-w-32 rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-surface',
                interaction.focusRingPanel,
              )}
            >
              {agentOptions.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agentListDisplayName(agent, messages(language).agentsSettings)}
                </option>
              ))}
            </select>
          ) : null}
          <select
            value={triggerFilter}
            aria-label={labels.boardTriggerFilterAria}
            onChange={(event) => setTriggerFilter(event.target.value)}
            className={cn(
              'h-9 min-w-[7.5rem] rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-surface',
              interaction.focusRingPanel,
            )}
          >
            <option value="all">{labels.boardTriggerFilterAll}</option>
            <option value="cron">{labels.boardTriggerFilterCron}</option>
            <option value="webui">{labels.boardTriggerFilterWebui}</option>
            <option value="chat">{labels.boardTriggerFilterChat}</option>
            <option value="api">{labels.boardTriggerFilterApi}</option>
          </select>
          <select
            value={workflowFilterId}
            aria-label={labels.boardWorkflowFilterAria}
            onChange={(event) => setWorkflowFilterId(event.target.value)}
            className={cn(
              'h-9 min-w-40 rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-surface',
              interaction.focusRingPanel,
            )}
          >
            <option value="">{labels.boardWorkflowFilterAll}</option>
            {definitions.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.title}
              </option>
            ))}
          </select>
        </section>

        {actionFeedback ? (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
            {actionFeedback}
          </div>
        ) : null}

        {(actionError ?? error) ? (
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {actionError ?? error}
          </div>
        ) : null}

        <WorkflowStatsBar stats={stats} language={language} />

        {selectedRunError ? (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            {selectedRunError}
          </div>
        ) : null}

        <div className="min-h-0 flex-1">
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
        onClose={() => setManageOpen(false)}
        onSave={(payload) => saveCustomWorkflow(payload)}
        onSaveAndStart={saveDraftAndStart}
      />
    </main>
  );
}
