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
  onOpenRun,
  onCancelRun,
  onRetryRun,
}: {
  column: WorkflowBoardColumnData;
  language: StoredLanguage;
  localeTag: string;
  nowMs: number;
  onOpenRun: (run: WorkflowRunSummary) => void;
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
        'flex min-h-[12rem] min-w-[16rem] flex-1 flex-col rounded-2xl border border-edge bg-surface-panel/40',
        'snap-center',
      )}
      aria-label={columnTitle(column.id, labels)}
    >
      <header className="flex items-center justify-between gap-2 border-b border-edge-subtle px-3 py-2.5">
        <h2 className="text-sm font-semibold text-fg">{columnTitle(column.id, labels)}</h2>
        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs tabular-nums text-fg-muted">
          {column.runs.length}
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-2 p-2">
        {visibleRuns.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-fg-subtle">{labels.boardColumnEmpty}</p>
        ) : (
          visibleRuns.map((run) => (
            <WorkflowTaskCard
              key={run.id}
              run={run}
              language={language}
              localeTag={localeTag}
              nowMs={nowMs}
              onOpen={onOpenRun}
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
