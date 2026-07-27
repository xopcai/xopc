import { type PointerEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowRunSummary } from './workflow-api';
import { WorkflowBoardColumn } from './workflow-board-column';
import { buildWorkflowBoardColumns, filterRunsForBoard } from './workflow-board.utils';

type BoardPanState = {
  pointerId: number;
  startX: number;
  scrollLeft: number;
  active: boolean;
};

function shouldIgnoreBoardPan(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return Boolean(target.closest('a,button,input,select,textarea,[contenteditable="true"],[draggable="true"],[data-board-pan-skip="true"]'));
}

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
  const boardScrollerRef = useRef<HTMLDivElement | null>(null);
  const boardPanRef = useRef<BoardPanState | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isPanningBoard, setIsPanningBoard] = useState(false);

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

  const endBoardPan = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const pan = boardPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    boardPanRef.current = null;
    setIsPanningBoard(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleBoardPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || shouldIgnoreBoardPan(event.target)) return;
    const scroller = boardScrollerRef.current;
    if (!scroller) return;
    boardPanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: scroller.scrollLeft,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleBoardPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const pan = boardPanRef.current;
    const scroller = boardScrollerRef.current;
    if (!pan || !scroller || pan.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pan.startX;
    if (!pan.active && Math.abs(deltaX) < 5) return;
    if (!pan.active) {
      pan.active = true;
      setIsPanningBoard(true);
    }
    event.preventDefault();
    scroller.scrollLeft = pan.scrollLeft - deltaX;
  }, []);

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
    <div
      ref={boardScrollerRef}
      className={[
        'min-h-0 h-full min-w-0 overflow-x-auto rounded-lg p-2',
        isPanningBoard ? 'cursor-grabbing select-none' : 'cursor-grab',
      ].join(' ')}
      onPointerDown={handleBoardPointerDown}
      onPointerMove={handleBoardPointerMove}
      onPointerUp={endBoardPan}
      onPointerCancel={endBoardPan}
      onLostPointerCapture={(event) => {
        if (boardPanRef.current?.pointerId === event.pointerId) {
          boardPanRef.current = null;
          setIsPanningBoard(false);
        }
      }}
    >
      <div className="flex min-h-full min-w-max items-start gap-3 pr-4">
      {columns.map((column) => (
        <WorkflowBoardColumn
          key={column.id}
          column={column}
          language={language}
          localeTag={localeTag}
          nowMs={nowMs}
          selectedRunId={selectedRunId}
          loading={loading}
          onOpenRun={onOpenRun}
          onOpenRunChat={onOpenRunChat}
          onCancelRun={onCancelRun}
          onRetryRun={onRetryRun}
        />
      ))}
      </div>
    </div>
  );
});
