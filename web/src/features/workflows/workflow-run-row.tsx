import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowRunSummary } from './workflow-api';
import { formatTime, interpolate, statusTone } from './workflow-page.utils';

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

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-xl border p-3 text-left transition-colors',
        selected ? 'border-accent bg-accent-soft/35' : 'border-edge bg-surface-panel hover:bg-surface-hover/60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{run.title}</div>
          <div className="mt-1 truncate text-xs text-fg-subtle">{run.definitionId}</div>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', statusTone(run.status))}>
          {statusLabel(run.status, labels)}
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-hover">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-fg-subtle">
        <span>
          {interpolate(labels.agentProgress, {
            done: run.metrics.doneAgentCount,
            total: run.metrics.agentCount,
          })}
        </span>
        <span>{formatTime(run.createdAtMs, localeTag)}</span>
      </div>
    </button>
  );
}
