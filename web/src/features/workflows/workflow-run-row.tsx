import type { ReactNode } from 'react';
import { Clock3, PackageCheck, UsersRound } from 'lucide-react';

import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowRunSummary } from './workflow-api';
import { formatDuration, formatTime, interpolate, statusTone } from './workflow-page.utils';

type WorkflowsMessages = ReturnType<typeof messages>['workflows'];

function statusLabel(status: WorkflowRunSummary['status'], labels: WorkflowsMessages): string {
  return labels.status[status] ?? status;
}

export function WorkflowRunRow({
  run,
  selected,
  language,
  localeTag,
  onSelect,
}: {
  run: WorkflowRunSummary;
  selected: boolean;
  language: StoredLanguage;
  localeTag: string;
  onSelect: () => void;
}) {
  const labels = messages(language).workflows;
  const progress = run.metrics.agentCount > 0
    ? Math.round((run.metrics.doneAgentCount / run.metrics.agentCount) * 100)
    : 0;
  const hasErrors = run.metrics.errorAgentCount > 0;
  const durationText = formatDuration(run.metrics.durationMs);
  const agentProgress = interpolate(labels.agentProgress, {
    done: run.metrics.doneAgentCount,
    total: run.metrics.agentCount,
  });

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-2xl border p-3 text-left transition-colors',
        selected ? 'border-accent bg-accent-soft/35' : 'border-edge bg-surface-panel hover:bg-surface-hover/60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="line-clamp-2 text-sm font-semibold leading-5 text-fg">{run.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
            <span className="truncate">{run.definitionId}</span>
            <span aria-hidden>·</span>
            <span>{formatTime(run.createdAtMs, localeTag)}</span>
          </div>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', statusTone(run.status))}>
          {statusLabel(run.status, labels)}
        </span>
      </div>

      <div className="mt-3 rounded-xl border border-edge-subtle bg-surface-base/50 p-2.5">
        <div className="flex items-center justify-between gap-3 text-[11px] text-fg-muted">
          <span>{agentProgress}</span>
          <span>{progress}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-hover">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5 text-[11px] text-fg-subtle">
        <RunRowFact icon={<UsersRound className="size-3.5" aria-hidden />} value={agentProgress} />
        <RunRowFact icon={<Clock3 className="size-3.5" aria-hidden />} value={durationText} />
        <RunRowFact
          icon={<PackageCheck className="size-3.5" aria-hidden />}
          value={String(run.metrics.artifactCount)}
        />
      </div>

      {hasErrors ? (
        <div className="mt-2 rounded-lg bg-red-500/10 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
          {interpolate(labels.runRowErrorSummary, { count: run.metrics.errorAgentCount })}
        </div>
      ) : null}
    </button>
  );
}

function RunRowFact({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1 rounded-lg bg-surface-hover px-2 py-1">
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{value}</span>
    </span>
  );
}
