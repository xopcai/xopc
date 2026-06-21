import { memo, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowRunSummary } from './workflow-api';
import { WorkflowBoardColumn } from './workflow-board-column';
import { buildWorkflowBoardColumns, filterRunsForBoard } from './workflow-board.utils';

export const WorkflowBoard = memo(function WorkflowBoard({
  runs,
  language,
  localeTag,
  labels,
  searchQuery,
  workflowFilterId,
  triggerFilter,
  selectedRunId,
  loading,
  onOpenRun,
  onOpenRunChat,
  onCancelRun,
  onRetryRun,
  onStart,
}: {
  runs: WorkflowRunSummary[];
  language: StoredLanguage;
  localeTag: string;
  labels: {
    boardEmptyTitle: string;
    boardEmptyHint: string;
    boardStart: string;
    loading: string;
  };
  searchQuery: string;
  workflowFilterId: string;
  triggerFilter: string;
  selectedRunId: string | null;
  loading: boolean;
  onOpenRun: (run: WorkflowRunSummary) => void;
  onOpenRunChat: (run: WorkflowRunSummary) => void;
  onCancelRun: (runId: string) => void;
  onRetryRun: (runId: string) => void;
  onStart: () => void;
}) {
  const hasActiveRuns = runs.some((run) => run.status === 'queued' || run.status === 'running');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!hasActiveRuns) return;
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [hasActiveRuns]);

  const columns = useMemo(() => {
    const filtered = filterRunsForBoard(runs, { searchQuery, workflowFilterId, triggerFilter });
    return buildWorkflowBoardColumns(filtered, nowMs);
  }, [nowMs, runs, searchQuery, triggerFilter, workflowFilterId]);

  const totalCards = columns.reduce((sum, col) => sum + col.runs.length, 0);

  if (loading && totalCards === 0) {
    return <p className="text-sm text-fg-muted">{labels.loading}</p>;
  }

  if (!loading && totalCards === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-2xl border border-dashed border-edge bg-surface-panel/40 px-6 py-12 text-center">
        <p className="text-sm font-medium text-fg">{labels.boardEmptyTitle}</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-fg-muted">{labels.boardEmptyHint}</p>
        <div className="mt-4 flex justify-center">
          <Button variant="primary" onClick={onStart}>
            {labels.boardStart}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-1 flex h-full min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3">
      {columns.map((column) => (
        <WorkflowBoardColumn
          key={column.id}
          column={column}
          language={language}
          localeTag={localeTag}
          nowMs={nowMs}
          selectedRunId={selectedRunId}
          onOpenRun={onOpenRun}
          onOpenRunChat={onOpenRunChat}
          onCancelRun={onCancelRun}
          onRetryRun={onRetryRun}
        />
      ))}
    </div>
  );
});
