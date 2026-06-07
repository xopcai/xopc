import type { ReactNode } from 'react';
import { useLayoutEffect } from 'react';
import { GitBranch } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { WorkflowCatalogCard } from './workflow-catalog-card';
import { WorkflowDefinitionDetailDialog } from './workflow-definition-detail-dialog';
import { WorkflowManageDialog } from './workflow-manage-dialog';
import { WorkflowRunPanel } from './workflow-run-panel';
import { WorkflowRunRow } from './workflow-run-row';
import { WorkflowStartDialog } from './workflow-start-dialog';
import { WorkflowStatsBar } from './workflow-stats-bar';
import { WORKFLOW_CATEGORY_FILTERS, WORKFLOW_SOURCE_FILTERS } from './workflow-page.constants';
import type { WorkflowsPageVm } from './use-workflows-page';
import { WorkflowsPageHeaderActions } from './workflows-page-header-actions';

export function WorkflowsPageView({ vm }: { vm: WorkflowsPageVm }) {
  const {
    language,
    localeTag,
    labels,
    hasToken,
    mainTab,
    setMainTab,
    categoryFilter,
    setCategoryFilter,
    sourceFilter,
    setSourceFilter,
    filteredDefinitions,
    activeRuns,
    visibleRuns,
    selectedRunId,
    selectRun,
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
    searchQuery,
    stats,
    runView,
    runLoading,
    submitStart,
    cancelSelectedRun,
    retrySelectedRun,
    saveCustomWorkflow,
    removeCustomWorkflow,
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
  }, [clearPageHeader, hasToken, loading, searchQuery, setPageHeader, vm.refreshAll, vm.setManageOpen, vm.setSearchQuery]);

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
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6 lg:px-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-fg">{labels.title}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">{labels.subtitle}</p>
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

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 border-b border-edge-subtle pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-x-1" role="tablist" aria-label={labels.navAria}>
              <TabButton active={mainTab === 'catalog'} onClick={() => setMainTab('catalog')}>
                {labels.tabCatalog}
              </TabButton>
              <TabButton active={mainTab === 'active'} onClick={() => setMainTab('active')}>
                {labels.tabActive}
                {activeRuns.length > 0 ? (
                  <span className="ml-1 tabular-nums text-fg-muted">({activeRuns.length})</span>
                ) : null}
              </TabButton>
              <TabButton active={mainTab === 'history'} onClick={() => setMainTab('history')}>
                {labels.tabHistory}
              </TabButton>
            </div>

            {mainTab === 'catalog' ? (
              <div className="flex flex-wrap gap-2">
                <FilterSelect
                  value={categoryFilter}
                  options={WORKFLOW_CATEGORY_FILTERS.map((key) => ({
                    value: key,
                    label: labels.categories[key],
                  }))}
                  onChange={(value) => setCategoryFilter(value as typeof categoryFilter)}
                  ariaLabel={labels.categoryFilterAria}
                />
                <FilterSelect
                  value={sourceFilter}
                  options={WORKFLOW_SOURCE_FILTERS.map((key) => ({
                    value: key,
                    label: labels.sources[key],
                  }))}
                  onChange={(value) => setSourceFilter(value as typeof sourceFilter)}
                  ariaLabel={labels.sourceFilterAria}
                />
              </div>
            ) : null}
          </div>

          <div className="space-y-6" hidden={mainTab !== 'catalog'}>
            {filteredDefinitions.length === 0 ? (
              <EmptyPanel title={labels.noDefinitions} hint={labels.noDefinitionsHint}>
                <Button variant="primary" onClick={() => setManageOpen(true)}>
                  {labels.addWorkflow}
                </Button>
              </EmptyPanel>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredDefinitions.map((definition) => (
                  <WorkflowCatalogCard
                    key={definition.id}
                    definition={definition}
                    language={language}
                    onRun={() => setStartDefinition(definition)}
                    onDetail={() => setDetailDefinition(definition)}
                    onDelete={
                      definition.metadata.source === 'user'
                        ? () => void removeCustomWorkflow(definition)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>

          <div
            className="grid gap-6 xl:grid-cols-[minmax(16rem,0.75fr)_minmax(0,1.25fr)]"
            hidden={mainTab === 'catalog'}
          >
            <div className="space-y-3">
              {loading && visibleRuns.length === 0 ? (
                <p className="text-sm text-fg-muted">{labels.loading}</p>
              ) : visibleRuns.length === 0 ? (
                <EmptyPanel
                  title={mainTab === 'active' ? labels.noActiveRuns : labels.noRuns}
                  hint={mainTab === 'active' ? labels.noActiveRunsHint : labels.noRunsHint}
                >
                  <Button variant="primary" onClick={() => setMainTab('catalog')}>
                    {labels.browseCatalog}
                  </Button>
                </EmptyPanel>
              ) : (
                visibleRuns.map((run) => (
                  <WorkflowRunRow
                    key={run.id}
                    run={run}
                    selected={selectedRunId === run.id}
                    language={language}
                    localeTag={localeTag}
                    onSelect={() => selectRun(run.id)}
                  />
                ))
              )}
            </div>

            <WorkflowRunPanel
              view={runView}
              loading={runLoading}
              language={language}
              localeTag={localeTag}
              onCancel={() => void cancelSelectedRun()}
              onRetry={() => void retrySelectedRun()}
            />
          </div>
        </section>
      </div>

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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'relative rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active ? 'text-fg' : 'text-fg-muted hover:text-fg',
        active &&
          'after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-9 after:-translate-x-1/2 after:rounded-full after:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

function FilterSelect({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        'h-9 rounded-lg border border-edge bg-surface-panel px-2.5 text-xs font-medium text-fg shadow-surface',
        interaction.focusRingPanel,
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function EmptyPanel({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-edge bg-surface-panel/40 px-6 py-10 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-fg-muted">{hint}</p>
      {children ? <div className="mt-4 flex justify-center">{children}</div> : null}
    </div>
  );
}
