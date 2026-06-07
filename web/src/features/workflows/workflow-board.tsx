import { memo, useMemo, useState } from 'react';

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
  loading,
  onOpenRun,
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
  loading: boolean;
  onOpenRun: (run: WorkflowRunSummary) => void;
  onCancelRun: (runId: string) => void;
  onRetryRun: (runId: string) => void;
  onStart: () => void;
}) {
  const [nowMs] = useState(() => Date.now());

  const columns = useMemo(() => {
    const filtered = filterRunsForBoard(runs, { searchQuery, workflowFilterId });
    return buildWorkflowBoardColumns(filtered, nowMs);
  }, [nowMs, runs, searchQuery, workflowFilterId]);

  const totalCards = columns.reduce((sum, col) => sum + col.runs.length, 0);

  if (loading && totalCards === 0) {
    return <p className="text-sm text-fg-muted">{labels.loading}</p>;
  }

  if (!loading && totalCards === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-edge bg-surface-panel/40 px-6 py-12 text-center">
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
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 snap-x snap-mandatory">
      {columns.map((column) => (
        <WorkflowBoardColumn
          key={column.id}
          column={column}
          language={language}
          localeTag={localeTag}
          nowMs={nowMs}
          onOpenRun={onOpenRun}
          onCancelRun={onCancelRun}
          onRetryRun={onRetryRun}
        />
      ))}
    </div>
  );
});
