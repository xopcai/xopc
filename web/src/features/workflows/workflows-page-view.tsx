import { useLayoutEffect } from 'react';
import { GitBranch, Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { WorkflowBoard } from './workflow-board';
import { WorkflowDefinitionDetailDialog } from './workflow-definition-detail-dialog';
import { WorkflowManageDialog } from './workflow-manage-dialog';
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
    workflowFilterId,
    setWorkflowFilterId,
    triggerFilter,
    setTriggerFilter,
    selectedRunId,
    selectedRunView,
    selectedRunLoading,
    selectedRunError,
    openRunDetails,
    closeRunDetails,
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
    saveCustomWorkflow,
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
      main: null,
      end: <WorkflowsPageHeaderActions vm={vm} />,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, hasToken, loading, vm, vm.refreshAll, vm.setManageOpen, vm.setSearchQuery]);

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
    <main className="min-h-0 flex-1 overflow-auto bg-surface-base">
      <div className="mx-auto flex w-full max-w-400 flex-col gap-5 px-4 py-6 lg:px-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-fg">{labels.title}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">{labels.subtitleBoard}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <Button variant="primary" onClick={() => setPickStartOpen(true)}>
              <Play className="size-4" aria-hidden />
              {labels.boardStart}
            </Button>
          </div>
        </header>

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

        <div className="min-w-0">
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
        loading={Boolean(selectedRunId) && selectedRunLoading}
        language={language}
        localeTag={localeTag}
        onCancel={() => {
          if (selectedRunId) void cancelRun(selectedRunId);
        }}
        onRetry={() => {
          if (selectedRunId) void retryRun(selectedRunId);
        }}
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

      <WorkflowManageDialog
        open={manageOpen}
        language={language}
        saving={savingWorkflow}
        onClose={() => setManageOpen(false)}
        onSave={(payload) => void saveCustomWorkflow(payload)}
      />
    </main>
  );
}
