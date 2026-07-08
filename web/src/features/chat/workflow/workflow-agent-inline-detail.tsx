import { memo } from 'react';
import { ChevronDown, X } from 'lucide-react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import type { WorkflowAgentSnapshot, WorkflowSnapshot } from './workflow.types';
import { formatAgentElapsed } from './workflow.utils';

export type WorkflowAgentInlineDetailLabels = {
  close: string;
  statusQueued: string;
  statusRunning: string;
  statusDone: string;
  statusError: string;
  statusSkipped: string;
  workedFor: (duration: string) => string;
  statusHeading: string;
  phaseHeading: string;
  elapsedHeading: string;
  currentStepHeading: string;
  executionHeading: string;
  outputHeading: string;
  stepsHeading: string;
  transcriptHeading: string;
  promptHeading: string;
  logsHeading: string;
  runningPlaceholder: string;
};

function statusLabel(agent: WorkflowAgentSnapshot, labels: WorkflowAgentInlineDetailLabels): string {
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

function agentStatusTone(status: WorkflowAgentSnapshot['status']): string {
  if (status === 'done') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'error') return 'bg-rose-500/10 text-rose-700 dark:text-rose-300';
  if (status === 'running') return 'bg-accent-soft text-accent-fg';
  return 'bg-surface-hover text-fg-subtle';
}

export const WorkflowAgentInlineDetail = memo(function WorkflowAgentInlineDetail({
  agent,
  snapshot,
  labels,
  className,
  onClose,
}: {
  agent: WorkflowAgentSnapshot | null;
  snapshot: WorkflowSnapshot | null;
  labels: WorkflowAgentInlineDetailLabels;
  className?: string;
  onClose?: () => void;
}) {
  if (!agent) return null;

  const elapsed = formatAgentElapsed(agent);
  const output = agent.error || agent.resultPreview || agent.currentStep || labels.runningPlaceholder;
  const logs = snapshot?.logs ?? [];
  const hasAdvanced = Boolean(agent.prompt?.trim()) || logs.length > 0;

  return (
    <section
      data-workflow-inline-detail
      className={cn('min-w-0 rounded-xl border border-edge-subtle bg-surface-base/55 p-3', className)}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h4 className="min-w-0 truncate text-sm font-semibold text-fg">{agent.label}</h4>
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', agentStatusTone(agent.status))}>
              {statusLabel(agent, labels)}
            </span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-fg-subtle">
            <span>{labels.phaseHeading}: <span className="text-fg-muted">{agent.phase || '-'}</span></span>
            <span>{labels.elapsedHeading}: <span className="tabular-nums text-fg-muted">{elapsed ? labels.workedFor(elapsed) : '-'}</span></span>
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            className={cn(
              'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted',
              'hover:bg-surface-hover hover:text-fg',
              interaction.transition,
              interaction.focusRingPanel,
            )}
            aria-label={labels.close}
            onClick={onClose}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      {agent.currentStep ? (
        <div className="mt-3 rounded-lg border border-edge-subtle bg-surface-panel px-2.5 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{labels.currentStepHeading}</div>
          <div className="mt-1 wrap-break-word text-sm text-fg-muted">{agent.currentStep}</div>
        </div>
      ) : null}

      <div className="mt-3 rounded-lg border border-edge-subtle bg-surface-panel px-2.5 py-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{labels.outputHeading}</div>
        <div
          className={cn(
            'mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap wrap-break-word text-sm leading-6',
            agent.error ? 'font-mono text-rose-600 dark:text-rose-400' : 'text-fg-muted',
          )}
        >
          {output}
        </div>
      </div>

      {agent.steps?.length ? (
        <div className="mt-3 space-y-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{labels.stepsHeading}</div>
          {agent.steps.map((step) => (
            <div key={step.id} className="rounded-lg bg-surface-panel px-2.5 py-2">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium text-fg">{step.label}</span>
                <span className="shrink-0 text-[10px] text-fg-subtle">{step.status}</span>
              </div>
              {step.detail || step.resultPreview || step.error ? (
                <div className="mt-1 whitespace-pre-wrap wrap-break-word text-xs leading-5 text-fg-muted">
                  {step.error || step.resultPreview || step.detail}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {hasAdvanced ? (
        <details className="group mt-3 rounded-lg border border-edge-subtle bg-surface-panel">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-xs font-medium text-fg-muted">
            {labels.executionHeading}
            <ChevronDown className="size-3.5 shrink-0 text-fg-subtle transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="space-y-3 border-t border-edge-subtle p-2.5">
            {agent.prompt?.trim() ? (
              <div className="min-w-0">
                <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{labels.promptHeading}</div>
                <pre className="mt-1 max-h-40 min-w-0 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-md bg-surface-hover/45 p-2 font-mono text-xs leading-5 text-fg-muted">
                  {agent.prompt}
                </pre>
              </div>
            ) : null}
            {logs.length > 0 ? (
              <div className="min-w-0">
                <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{labels.logsHeading}</div>
                <div className="mt-1 max-h-36 space-y-0.5 overflow-y-auto rounded-md bg-surface-hover/45 p-2 font-mono text-xs leading-5 text-fg-subtle">
                  {logs.map((line) => (
                    <div key={line} className="wrap-break-word">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
});
