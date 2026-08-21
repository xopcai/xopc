import * as Dialog from '@radix-ui/react-dialog';
import { CircleStop, ExternalLink, GitBranch, ListChecks, ScrollText, X } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { workflowCardLabels } from '@/features/chat/workflow/workflow-card-labels';
import { ProgressTree } from '@/features/chat/workflow/workflow-progress-display';
import { WorkflowResultSummary } from '@/features/chat/workflow/workflow-result-summary';
import type { WorkflowAgentSnapshot } from '@/features/chat/workflow/workflow.types';
import { formatDuration, rollupPhases } from '@/features/chat/workflow/workflow.utils';
import { WorkflowAgentInlineDetail } from '@/features/chat/workflow/workflow-agent-inline-detail';
import { cancelWorkflowRun, type WorkflowRunStatus, type WorkflowRunView } from '@/features/workflows/workflow-api';
import { runViewToSnapshot } from '@/features/workflows/run-view-to-snapshot';
import { ACTIVE_RUN_STATUSES } from '@/features/workflows/workflow-page.constants';
import { isWorkflowResultEnvelope, workflowBoardHref } from '@/features/workflows/workflow-page.utils';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

type WorkflowLiveTab = 'overview' | 'agents' | 'logs' | 'result';

function statusClass(status: WorkflowRunStatus): string {
  if (status === 'succeeded') return 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed' || status === 'timeout') return 'border-destructive/40 text-destructive';
  if (status === 'cancelled') return 'border-warning/40 text-warning';
  return 'border-accent/40 text-accent';
}

/** Live workflow state pinned above the message list in workflow sessions. */
export const WorkflowSessionBanner = memo(function WorkflowSessionBanner({
  view,
  onAbortCurrentTurn,
}: {
  view: WorkflowRunView;
  sessionKey: string | null;
  onAbortCurrentTurn?: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const labels = workflowCardLabels(language);
  const live = labels.live;
  const snapshot = useMemo(() => runViewToSnapshot(view), [view]);
  const rollup = useMemo(() => rollupPhases(snapshot), [snapshot]);
  const isActive = ACTIVE_RUN_STATUSES.has(view.run.status);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkflowLiveTab>('overview');
  const [selectedAgent, setSelectedAgent] = useState<WorkflowAgentSnapshot | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [isActive]);

  const elapsedMs = isActive && view.run.startedAtMs
    ? Date.now() - view.run.startedAtMs
    : view.run.metrics.durationMs ?? snapshot.durationMs ?? 0;
  const elapsed = elapsedMs ? formatDuration(elapsedMs) : '';
  const progress = live.progress(snapshot.doneCount, snapshot.agentCount);
  const currentState = snapshot.currentPhase || live.activeFallback;
  const title = view.run.goal.trim() || view.run.title || view.run.definitionId;
  const ownerAgentId = view.run.metadata?.agentId;
  const logs = view.logs.map((entry) => entry.message).filter(Boolean);

  const handleAbort = () => {
    if (isActive) {
      void cancelWorkflowRun(view.run.id, { ownerAgentId }).catch(() => {
        /* Realtime / polling will reflect terminal state. */
      });
    }
    onAbortCurrentTurn?.();
  };

  const tabs: Array<{ id: WorkflowLiveTab; label: string }> = [
    { id: 'overview', label: live.overview },
    { id: 'agents', label: live.agents },
    { id: 'logs', label: live.logs },
    { id: 'result', label: live.result },
  ];

  return (
    <div className="mb-6">
      <div className="flex min-h-12 items-center gap-2 rounded-xl border border-edge bg-surface-panel px-2.5 py-2 shadow-surface sm:px-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left outline-none hover:bg-surface-hover/70 focus-visible:ring-2 focus-visible:ring-accent"
          onClick={() => setDetailsOpen(true)}
        >
          <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-fg">
            <GitBranch className="size-4" aria-hidden />
            {isActive ? (
              <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface-panel bg-accent motion-safe:animate-pulse" />
            ) : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-fg-muted">
              <span className="font-medium text-fg">{live.status[view.run.status]}</span>
              <span className={cn('rounded-full border px-1.5 py-0.5', statusClass(view.run.status))}>
                {progress}
              </span>
              <span className="truncate">{currentState}</span>
              {elapsed ? (
                <span>
                  {live.elapsed}: <span className="text-fg">{elapsed}</span>
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-sm font-medium leading-tight text-fg">{title}</span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {isActive ? (
            <Button type="button" variant="ghost" className="hidden h-8 px-2 text-xs sm:inline-flex" onClick={handleAbort}>
              <CircleStop className="size-3.5" aria-hidden />
              {live.stop}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" className="h-8 px-2.5 text-xs" onClick={() => setDetailsOpen(true)}>
            {live.details}
          </Button>
        </div>
      </div>

      <Dialog.Root open={detailsOpen} onOpenChange={setDetailsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[120] bg-scrim backdrop-blur-[1px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[121] flex h-[min(84vh,44rem)] w-[min(100vw-2rem,54rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover outline-none">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <GitBranch className="size-4 shrink-0 text-accent" aria-hidden />
                  <Dialog.Title className="truncate text-sm font-semibold text-fg">{live.title}</Dialog.Title>
                  <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px]', statusClass(view.run.status))}>
                    {live.status[view.run.status]}
                  </span>
                </div>
                <Dialog.Description className="mt-1 line-clamp-2 text-xs text-fg-muted">
                  {title}
                </Dialog.Description>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button asChild type="button" variant="ghost" className="h-8 px-2 text-xs">
                  <Link to={workflowBoardHref(view.run.id, { ownerAgentId })}>
                    <ExternalLink className="size-3.5" aria-hidden />
                    {live.openRun}
                  </Link>
                </Button>
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" className="size-8 p-0" aria-label={live.close}>
                    <X className="size-4" aria-hidden />
                  </Button>
                </Dialog.Close>
              </div>
            </div>

            <div className="flex shrink-0 gap-1 border-b border-edge px-4 py-2" role="tablist" aria-label={live.title}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    activeTab === tab.id ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                  )}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {activeTab === 'overview' ? (
                <div className="grid gap-3">
                  <section className="rounded-lg border border-edge bg-surface-base p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
                      <ListChecks className="size-4 text-accent" aria-hidden />
                      {live.currentState}
                    </div>
                    <div className="grid gap-2 text-sm text-fg-muted sm:grid-cols-2">
                      <p>
                        <span className="font-medium text-fg">{live.status[view.run.status]}</span>
                        <span className="mx-1 text-fg-subtle">·</span>
                        {currentState}
                      </p>
                      <p>{progress}</p>
                      {elapsed ? <p>{live.elapsed}: <span className="text-fg">{elapsed}</span></p> : null}
                      <p className="break-all">{live.runId}: <span className="font-mono text-xs">{view.run.id}</span></p>
                    </div>
                  </section>
                  {view.run.error?.message ? (
                    <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {view.run.error.message}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {activeTab === 'agents' ? (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
                  <ProgressTree
                    rollup={rollup}
                    currentPhase={snapshot.currentPhase}
                    labels={labels.phase}
                    recentLogs={[]}
                    recentLogsHeading={labels.recentLogsHeading}
                    showAllLogsLabel={labels.showAllLogs}
                    logsExpanded={false}
                    onToggleLogs={() => undefined}
                    selectedAgentId={selectedAgent?.id}
                    onSelectAgent={setSelectedAgent}
                  />
                  <WorkflowAgentInlineDetail
                    agent={selectedAgent}
                    snapshot={snapshot}
                    labels={labels.checkDetail}
                    onClose={() => setSelectedAgent(null)}
                  />
                </div>
              ) : null}

              {activeTab === 'logs' ? (
                <section className="rounded-lg border border-edge bg-surface-base p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
                    <ScrollText className="size-4 text-accent" aria-hidden />
                    {live.logs}
                  </div>
                  {logs.length ? (
                    <div className="space-y-1">
                      {logs.map((line, index) => (
                        <p key={`${index}:${line}`} className="break-words font-mono text-xs leading-5 text-fg-muted">
                          {line}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-fg-muted">{labels.error.noExtraDetails}</p>
                  )}
                </section>
              ) : null}

              {activeTab === 'result' ? (
                isWorkflowResultEnvelope(view.run.result) ? (
                  <WorkflowResultSummary result={view.run.result} labels={labels.result} />
                ) : (
                  <p className="text-sm text-fg-muted">{live.noResult}</p>
                )
              ) : null}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-edge px-4 py-3">
              <span className="text-xs text-fg-muted">{view.run.definitionId}</span>
              <div className="flex items-center gap-2">
                {isActive ? (
                  <Button type="button" variant="secondary" className="h-8 text-xs" onClick={handleAbort}>
                    <CircleStop className="size-3.5" aria-hidden />
                    {live.stop}
                  </Button>
                ) : null}
                <Button asChild type="button" variant="primary" className="h-8 text-xs">
                  <Link to={workflowBoardHref(view.run.id, { ownerAgentId })}>
                    <ExternalLink className="size-3.5" aria-hidden />
                    {live.openRun}
                  </Link>
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

    </div>
  );
});
