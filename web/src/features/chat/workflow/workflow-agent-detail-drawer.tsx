/**
 * Right-hand drawer for a single workflow subagent — prompt, live steps, output, logs.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { memo, useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import { WorkflowAgentStepList, type WorkflowAgentStepListLabels } from './workflow-agent-step-list';
import { WorkflowAgentStreamPanel, type WorkflowAgentStreamPanelLabels } from './workflow-agent-stream-panel';
import type { WorkflowAgentSnapshot, WorkflowSnapshot } from './workflow.types';
import { formatAgentElapsed } from './workflow.utils';

export type WorkflowAgentDetailDrawerLabels = {
  close: string;
  statusQueued: string;
  statusRunning: string;
  statusDone: string;
  statusError: string;
  statusSkipped: string;
  workedFor: (duration: string) => string;
  phaseHeading: string;
  promptHeading: string;
  stepsHeading: string;
  outputHeading: string;
  logsHeading: string;
  pin: string;
  pinned: string;
  runningPlaceholder: string;
  steps: WorkflowAgentStepListLabels;
  stream: WorkflowAgentStreamPanelLabels;
};

function statusLabel(agent: WorkflowAgentSnapshot, labels: WorkflowAgentDetailDrawerLabels): string {
  switch (agent.status) {
    case 'queued':
      return labels.statusQueued;
    case 'running':
      return labels.statusRunning;
    case 'done':
      return labels.statusDone;
    case 'error':
      return labels.statusError;
    case 'skipped':
      return labels.statusSkipped;
    default:
      return agent.status;
  }
}

export const WorkflowAgentDetailDrawer = memo(function WorkflowAgentDetailDrawer({
  open,
  agent,
  snapshot,
  pinnedAgentId,
  onPinAgent,
  onClose,
  labels,
}: {
  open: boolean;
  agent: WorkflowAgentSnapshot | null;
  snapshot: WorkflowSnapshot | null;
  pinnedAgentId: number | null;
  onPinAgent: (id: number | null) => void;
  onClose: () => void;
  labels: WorkflowAgentDetailDrawerLabels;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open || agent?.status !== 'running') return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [open, agent?.status]);

  const elapsed = agent ? formatAgentElapsed(agent) : '';

  const isPinned = agent != null && pinnedAgentId === agent.id;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[70] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-drawer-right fixed right-0 top-0 z-[71] flex size-full max-w-md flex-col border-l border-edge bg-surface-panel shadow-popover outline-none',
          )}
          aria-describedby={undefined}
        >
          {agent ? (
            <>
              <div className="flex min-w-0 shrink-0 items-start justify-between gap-2 border-b border-edge px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="truncate text-base font-medium text-fg">
                    {agent.label}
                  </Dialog.Title>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
                    <span>{statusLabel(agent, labels)}</span>
                    {elapsed ? (
                      <span className="tabular-nums text-fg-subtle">{labels.workedFor(elapsed)}</span>
                    ) : null}
                    {agent.phase ? (
                      <span className="truncate text-fg-disabled">
                        {labels.phaseHeading}: {agent.phase}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {agent.status === 'running' ? (
                    <button
                      type="button"
                      onClick={() => onPinAgent(isPinned ? null : agent.id)}
                      className={cn(
                        'inline-flex h-7 items-center rounded-md px-2 text-xs',
                        isPinned
                          ? 'bg-accent/15 text-accent-fg'
                          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                        interaction.transition,
                        interaction.focusRingPanel,
                      )}
                      aria-pressed={isPinned}
                    >
                      {isPinned ? labels.pinned : labels.pin}
                    </button>
                  ) : null}
                  <Dialog.Close
                    type="button"
                    className={cn(
                      'inline-flex size-8 items-center justify-center rounded-md text-fg-muted',
                      'hover:bg-surface-hover hover:text-fg',
                      interaction.transition,
                      interaction.focusRingPanel,
                    )}
                    aria-label={labels.close}
                  >
                    <X className="size-4" />
                  </Dialog.Close>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
                <section className="min-w-0">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                    {labels.promptHeading}
                  </div>
                  <pre className="max-h-40 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-edge-subtle bg-surface-hover/30 p-2 font-mono text-xs text-fg-muted">
                    {agent.prompt}
                  </pre>
                </section>

                <section className="min-w-0">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                    {labels.stepsHeading}
                  </div>
                  {agent.status === 'running' &&
                  !agent.steps?.length &&
                  !agent.currentStep ? (
                    <div className="text-xs text-fg-subtle">{labels.runningPlaceholder}</div>
                  ) : (
                    <WorkflowAgentStepList
                      steps={agent.steps}
                      iteration={agent.iteration}
                      maxIterations={agent.maxIterations}
                      labels={labels.steps}
                    />
                  )}
                  {agent.currentStep ? (
                    <div className="mt-2 truncate text-xs text-accent-fg">{agent.currentStep}</div>
                  ) : null}
                </section>

                {agent.streamText?.trim() ? (
                  <section className="min-w-0">
                    <WorkflowAgentStreamPanel streamText={agent.streamText} labels={labels.stream} />
                  </section>
                ) : null}

                {agent.resultPreview || agent.error ? (
                  <section className="min-w-0">
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                      {labels.outputHeading}
                    </div>
                    {agent.error ? (
                      <div className="font-mono text-xs text-rose-600 dark:text-rose-400">
                        {agent.error}
                      </div>
                    ) : (
                      <div className="max-h-48 min-w-0 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs text-fg-muted">
                        {agent.resultPreview}
                      </div>
                    )}
                  </section>
                ) : null}

                {snapshot && snapshot.logs.length > 0 ? (
                  <section className="min-w-0">
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                      {labels.logsHeading}
                    </div>
                    <div className="max-h-32 space-y-0.5 overflow-y-auto font-mono text-xs text-fg-subtle">
                      {snapshot.logs.map((line, i) => (
                        <div key={i} className="break-words">
                          {line}
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
});
