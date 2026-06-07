import { describe, expect, it } from 'vitest';

import type { WorkflowRunSummary } from '@/features/workflows/workflow-api';
import {
  BOARD_SUCCEEDED_MAX,
  BOARD_SUCCEEDED_WINDOW_MS,
  boardColumnForRun,
  buildWorkflowBoardColumns,
  filterRunsForBoard,
  sortRunsForBoardColumn,
} from '@/features/workflows/workflow-board.utils';

function run(partial: Partial<WorkflowRunSummary> & Pick<WorkflowRunSummary, 'id' | 'status'>): WorkflowRunSummary {
  return {
    definitionId: 'audit_repo',
    title: partial.title ?? 'Audit repo',
    source: { kind: 'webui' },
    metrics: {
      agentCount: 2,
      doneAgentCount: 0,
      errorAgentCount: 0,
      skippedAgentCount: 0,
      artifactCount: 0,
    },
    createdAtMs: 1_000,
    ...partial,
  };
}

describe('workflow board utils', () => {
  const now = 10_000_000;

  it('groups runs into board columns', () => {
    const runs = [
      run({ id: 'q1', status: 'queued', createdAtMs: 100 }),
      run({ id: 'r1', status: 'running', startedAtMs: 500 }),
      run({ id: 's1', status: 'succeeded', completedAtMs: now - 1_000 }),
      run({ id: 'f1', status: 'failed', completedAtMs: now - 2_000 }),
    ];

    const columns = buildWorkflowBoardColumns(runs, now);
    expect(columns.find((c) => c.id === 'queued')?.runs.map((r) => r.id)).toEqual(['q1']);
    expect(columns.find((c) => c.id === 'running')?.runs.map((r) => r.id)).toEqual(['r1']);
    expect(columns.find((c) => c.id === 'succeeded')?.runs.map((r) => r.id)).toEqual(['s1']);
    expect(columns.find((c) => c.id === 'attention')?.runs.map((r) => r.id)).toEqual(['f1']);
  });

  it('excludes succeeded runs older than 7 days', () => {
    const old = run({
      id: 'old',
      status: 'succeeded',
      completedAtMs: now - BOARD_SUCCEEDED_WINDOW_MS - 1,
    });
    expect(boardColumnForRun(old, now)).toBeNull();
  });

  it('caps succeeded column at 20 runs', () => {
    const runs = Array.from({ length: 25 }, (_, index) =>
      run({
        id: `s${index}`,
        status: 'succeeded',
        completedAtMs: now - index * 1_000,
      }),
    );
    const succeeded = buildWorkflowBoardColumns(runs, now).find((c) => c.id === 'succeeded');
    expect(succeeded?.runs).toHaveLength(BOARD_SUCCEEDED_MAX);
    expect(succeeded?.hiddenByCap).toBe(5);
  });

  it('sorts queued runs oldest first', () => {
    const runs = [
      run({ id: 'b', status: 'queued', createdAtMs: 200 }),
      run({ id: 'a', status: 'queued', createdAtMs: 100 }),
    ];
    expect(sortRunsForBoardColumn('queued', runs).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('filters by workflow id and search query', () => {
    const runs = [
      run({ id: '1', status: 'running', definitionId: 'audit_repo', title: 'Check repo' }),
      run({ id: '2', status: 'running', definitionId: 'research', title: 'Market scan' }),
    ];
    expect(
      filterRunsForBoard(runs, { searchQuery: 'market', workflowFilterId: '' }).map((r) => r.id),
    ).toEqual(['2']);
    expect(
      filterRunsForBoard(runs, { searchQuery: '', workflowFilterId: 'audit_repo' }).map((r) => r.id),
    ).toEqual(['1']);
  });
});
