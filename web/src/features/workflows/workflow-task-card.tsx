import { AlertTriangle, MoreHorizontal } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

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

export const WorkflowTaskCard = memo(function WorkflowTaskCard({
  run,
  language,
  localeTag,
  nowMs,
  selected,
  onOpen,
  onOpenChat,
  onCancel,
  onRetry,
}: {
  run: WorkflowRunSummary;
  language: StoredLanguage;
  localeTag: string;
  nowMs: number;
  selected?: boolean;
  onOpen: (run: WorkflowRunSummary) => void;
  onOpenChat: (run: WorkflowRunSummary) => void;
  onCancel: (runId: string) => void;
  onRetry: (runId: string) => void;
}) {
  const labels = messages(language).workflows;
  const [menuOpen, setMenuOpen] = useState(false);
  const sessionKey = resolveRunSessionKey(run);
  const chatDisabled = !sessionKey;
  const active = isRunActive(run);
  const showProgress = run.status === 'running' || run.status === 'queued';
  const progress =
    run.metrics.agentCount > 0
      ? Math.round((run.metrics.doneAgentCount / run.metrics.agentCount) * 100)
      : 0;
  const hasErrors = run.metrics.errorAgentCount > 0;
  const timeMs = run.startedAtMs ?? run.createdAtMs;
  const durationMs = active ? nowMs - timeMs : run.metrics.durationMs;
  const durationText = formatDuration(durationMs);
  const artifactText = interpolate(labels.taskArtifacts, { count: run.metrics.artifactCount });
  const cardTitle = resolveRunCardTitle(run);
  const workflowLabel = resolveRunWorkflowLabel(run);

  const handleOpen = useCallback(() => {
    onOpen(run);
  }, [onOpen, run]);

  const handleOpenChat = useCallback(() => {
    if (chatDisabled) return;
    onOpenChat(run);
  }, [chatDisabled, onOpenChat, run]);

  return (
    <div
      className={cn(
        'group relative rounded-xl border bg-surface-panel p-3 transition-colors',
        selected ? 'border-accent/70 ring-1 ring-accent/30' : 'border-edge',
        'hover:border-edge-strong hover:bg-surface-hover/50',
      )}
    >
      <button
        type="button"
        onClick={handleOpen}
        aria-label={`${labels.taskOpenDetails}: ${cardTitle}`}
        aria-current={selected ? 'true' : undefined}
        className={cn('w-full text-left', interaction.focusRingPanel)}
      >
        <div className="pr-7">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="line-clamp-2 min-w-0 text-sm font-medium leading-5 text-fg">
              {cardTitle}
            </div>
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', statusTone(run.status))}>
              {labels.status[run.status] ?? run.status}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-fg-subtle">
            <span className="truncate">{workflowLabel}</span>
            <span aria-hidden>·</span>
            <span>{formatRelativeTime(timeMs, nowMs, localeTag)}</span>
            {durationText !== '—' ? (
              <>
                <span aria-hidden>·</span>
                <span>{interpolate(labels.taskElapsed, { duration: durationText })}</span>
              </>
            ) : null}
          </div>
        </div>

        {showProgress ? (
          <div className="mt-2.5">
            <div className="flex items-center justify-between gap-2 text-[11px] text-fg-muted">
              <span>
                {interpolate(labels.agentProgress, {
                  done: run.metrics.doneAgentCount,
                  total: run.metrics.agentCount,
                })}
              </span>
              <span>{progress}%</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-hover">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
          {run.metrics.artifactCount > 0 ? <span>{artifactText}</span> : null}
          {selected ? <span className="text-accent-fg">{labels.taskOpenDetails}</span> : null}
        </div>

        {hasErrors ? (
          <div className="mt-2 flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3 shrink-0" aria-hidden />
            {interpolate(labels.runRowErrorSummary, { count: run.metrics.errorAgentCount })}
          </div>
        ) : null}
      </button>

      <div className="absolute right-2 top-2">
        <Button
          variant="ghost"
          className="size-7 p-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label={labels.taskActionsAria}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
        {menuOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-10 cursor-default"
              aria-label={labels.taskCloseMenu}
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 z-20 mt-1 min-w-36 rounded-lg border border-edge bg-surface-panel py-1 shadow-surface">
              <TaskMenuItem
                label={labels.continueInChat}
                disabled={chatDisabled}
                onClick={() => {
                  setMenuOpen(false);
                  handleOpenChat();
                }}
              />
              {active ? (
                <TaskMenuItem
                  label={labels.cancel}
                  tone="danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onCancel(run.id);
                  }}
                />
              ) : null}
              {isRunRetriable(run) ? (
                <TaskMenuItem
                  label={labels.rerun}
                  onClick={() => {
                    setMenuOpen(false);
                    onRetry(run.id);
                  }}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
});

function TaskMenuItem({
  label,
  disabled,
  tone,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  tone?: 'danger';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'block w-full px-3 py-1.5 text-left text-xs',
        disabled ? 'cursor-not-allowed text-fg-subtle' : 'text-fg hover:bg-surface-hover',
        tone === 'danger' && !disabled && 'text-red-600 dark:text-red-300',
      )}
    >
      {label}
    </button>
  );
}
