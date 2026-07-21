import { AlertTriangle, ChevronRight } from 'lucide-react';
import { memo } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowRunSummary } from './workflow-api';
import {
  formatRelativeTime,
  isRunActive,
  isRunRetriable,
  resolveRunCardTitle,
  resolveRunSessionKey,
  resolveRunWorkflowLabel,
} from './workflow-board.utils';
import { formatDuration, interpolate, statusTone } from './workflow-page.utils';

export const WorkflowRunRow = memo(function WorkflowRunRow({
  run,
  language,
  localeTag,
  nowMs,
  onOpen,
  onOpenChat,
  onCancel,
  onRetry,
}: {
  run: WorkflowRunSummary;
  language: StoredLanguage;
  localeTag: string;
  nowMs: number;
  onOpen: (run: WorkflowRunSummary) => void;
  onOpenChat: (run: WorkflowRunSummary) => void;
  onCancel: (runId: string) => void;
  onRetry: (runId: string) => void;
}) {
  const labels = messages(language).workflows;
  const active = isRunActive(run);
  const retriable = isRunRetriable(run);
  const hasChat = Boolean(resolveRunSessionKey(run));
  const timeMs = run.startedAtMs ?? run.createdAtMs;
  const durationMs = active ? nowMs - timeMs : run.metrics.durationMs;
  const durationText = formatDuration(durationMs);
  const progress = run.metrics.agentCount > 0
    ? Math.round((run.metrics.doneAgentCount / run.metrics.agentCount) * 100)
    : 0;

  return (
    <article className="group border-b border-edge-subtle last:border-b-0">
      <div className="flex min-w-0 flex-col gap-3 px-3 py-3 transition-colors hover:bg-surface-hover/55 sm:px-4 lg:flex-row lg:items-center">
        <button
          type="button"
          onClick={() => onOpen(run)}
          className={cn('min-w-0 flex-1 text-left', interaction.focusRingPanel)}
          aria-label={`${labels.taskOpenDetails}: ${resolveRunCardTitle(run)}`}
        >
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                'mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                statusTone(run.status),
              )}
            >
              {labels.status[run.status] ?? run.status}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">{resolveRunCardTitle(run)}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                <span className="truncate font-medium">{resolveRunWorkflowLabel(run)}</span>
                <span aria-hidden>·</span>
                <span>{formatRelativeTime(timeMs, nowMs, localeTag)}</span>
                {durationText !== '—' ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{interpolate(labels.taskElapsed, { duration: durationText })}</span>
                  </>
                ) : null}
              </span>
              {active && run.metrics.agentCount > 0 ? (
                <span className="mt-2 block max-w-md">
                  <span className="flex items-center justify-between text-[11px] text-fg-subtle">
                    <span>{interpolate(labels.agentProgress, { done: run.metrics.doneAgentCount, total: run.metrics.agentCount })}</span>
                    <span className="tabular-nums">{progress}%</span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-muted">
                    <span
                      className="block h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none"
                      style={{ width: `${progress}%` }}
                    />
                  </span>
                </span>
              ) : null}
              {run.metrics.errorAgentCount > 0 ? (
                <span className="mt-2 flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="size-3 shrink-0" aria-hidden />
                  {interpolate(labels.runRowErrorSummary, { count: run.metrics.errorAgentCount })}
                </span>
              ) : null}
            </span>
          </div>
        </button>

        <div className="flex shrink-0 items-center justify-end gap-1.5 pl-7 lg:pl-0">
          {retriable ? (
            <Button type="button" variant="primary" className="h-8 rounded-lg text-xs" onClick={() => onRetry(run.id)}>
              {labels.rerun}
            </Button>
          ) : null}
          {run.status === 'succeeded' && hasChat ? (
            <Button type="button" variant="secondary" className="h-8 rounded-lg text-xs" onClick={() => onOpenChat(run)}>
              {labels.continueInChat}
            </Button>
          ) : null}
          {active ? (
            <Button type="button" variant="ghost" className="h-8 rounded-lg text-xs text-red-600 dark:text-red-300" onClick={() => onCancel(run.id)}>
              {labels.cancel}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" className="size-8 p-0" aria-label={labels.taskOpenDetails} onClick={() => onOpen(run)}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </article>
  );
});
