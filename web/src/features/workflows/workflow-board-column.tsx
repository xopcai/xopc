import { memo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowRunSummary } from './workflow-api';
import {
  BOARD_SUCCEEDED_COLLAPSED,
  type WorkflowBoardColumnData,
  type WorkflowBoardColumnId,
} from './workflow-board.utils';
import { interpolate } from './workflow-page.utils';
import { WorkflowTaskCard } from './workflow-task-card';

type WorkflowsMessages = ReturnType<typeof messages>['workflows'];

function columnTitle(column: WorkflowBoardColumnId, labels: WorkflowsMessages): string {
  return labels.boardColumns[column];
}

export const WorkflowBoardColumn = memo(function WorkflowBoardColumn({
  column,
  language,
  localeTag,
  nowMs,
  selectedRunId,
  onOpenRun,
  onOpenRunChat,
  onCancelRun,
  onRetryRun,
}: {
  column: WorkflowBoardColumnData;
  language: StoredLanguage;
  localeTag: string;
  nowMs: number;
  selectedRunId: string | null;
  onOpenRun: (run: WorkflowRunSummary) => void;
  onOpenRunChat: (run: WorkflowRunSummary) => void;
  onCancelRun: (runId: string) => void;
  onRetryRun: (runId: string) => void;
}) {
  const labels = messages(language).workflows;
  const [expanded, setExpanded] = useState(false);
  const isSucceeded = column.id === 'succeeded';
  const collapsedLimit = isSucceeded ? BOARD_SUCCEEDED_COLLAPSED : column.runs.length;
  const visibleRuns =
    isSucceeded && !expanded ? column.runs.slice(0, collapsedLimit) : column.runs;
  const canExpand =
    isSucceeded && column.runs.length > BOARD_SUCCEEDED_COLLAPSED && !expanded;
  const canCollapse = isSucceeded && expanded;

  return (
    <section
      className={cn(
        'flex min-h-112 w-73 shrink-0 snap-center flex-col rounded-2xl border border-edge bg-surface-panel/40',
      )}
      aria-label={columnTitle(column.id, labels)}
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-t-2xl border-b border-edge-subtle bg-surface-panel/90 px-3.5 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 rounded-full bg-accent" aria-hidden />
          <h2 className="truncate text-sm font-semibold text-fg">{columnTitle(column.id, labels)}</h2>
        </div>
        <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs font-semibold tabular-nums text-fg-muted">
          {column.runs.length}
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-3 p-2.5">
        {visibleRuns.length === 0 ? (
          <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-edge bg-surface-panel/40 px-4 py-6 text-center text-xs text-fg-subtle">
            {labels.boardColumnEmpty}
          </div>
        ) : (
          visibleRuns.map((run) => (
            <WorkflowTaskCard
              key={run.id}
              run={run}
              language={language}
              localeTag={localeTag}
              nowMs={nowMs}
              selected={run.id === selectedRunId}
              onOpen={onOpenRun}
              onOpenChat={onOpenRunChat}
              onCancel={onCancelRun}
              onRetry={onRetryRun}
            />
          ))
        )}

        {canExpand ? (
          <Button variant="ghost" className="h-8 w-full text-xs" onClick={() => setExpanded(true)}>
            {interpolate(labels.boardExpandSucceeded, {
              count: Math.min(column.runs.length, column.totalInWindow ?? column.runs.length),
            })}
          </Button>
        ) : null}

        {canCollapse ? (
          <Button variant="ghost" className="h-8 w-full text-xs" onClick={() => setExpanded(false)}>
            {labels.boardCollapseSucceeded}
          </Button>
        ) : null}

        {isSucceeded && (column.hiddenByCap ?? 0) > 0 ? (
          <p className="px-1 text-center text-[11px] text-fg-subtle">
            {interpolate(labels.boardSucceededCapHint, { count: column.hiddenByCap ?? 0 })}
          </p>
        ) : null}
      </div>
    </section>
  );
});
