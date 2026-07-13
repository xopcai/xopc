import { MoreHorizontal } from 'lucide-react';
import { memo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
  loading,
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
  loading: boolean;
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
        'flex max-h-full w-72 min-w-72 max-w-72 shrink-0 flex-col overflow-y-auto rounded-lg bg-surface-base shadow-surface',
      )}
      aria-label={columnTitle(column.id, labels)}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-sm font-semibold text-fg">{columnTitle(column.id, labels)}</h2>
          <span className="shrink-0 text-xs text-fg-subtle">{column.runs.length}</span>
        </div>
        <MoreHorizontal className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      </header>

      <div className="mx-2 mt-3 grid min-h-0 min-w-0 content-start gap-2 pb-2 pr-1 [scrollbar-gutter:stable]">
        {loading && visibleRuns.length === 0 ? (
          <WorkflowBoardCardSkeleton />
        ) : visibleRuns.length === 0 ? (
          <div className="rounded-lg bg-surface-panel/70 px-3 py-6 text-center text-xs text-fg-subtle">
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

      </div>
    </section>
  );
});

function WorkflowBoardCardSkeleton() {
  return (
    <article className="min-h-24 rounded-lg bg-surface-panel px-3 py-3 shadow-surface" aria-hidden="true">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-3 w-2/3" />
      <Skeleton className="mt-4 h-5 w-20 rounded-full" />
    </article>
  );
}
