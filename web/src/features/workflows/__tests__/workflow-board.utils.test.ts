import { describe, expect, it } from 'vitest';

import type { WorkflowRunSummary } from '@/features/workflows/workflow-api';
import {
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

  it('keeps old succeeded runs visible in history', () => {
    const old = run({
      id: 'old',
      status: 'succeeded',
      completedAtMs: now - 30 * 24 * 60 * 60 * 1000,
    });
    expect(boardColumnForRun(old, now)).toBe('succeeded');
  });

  it('filters runs by trigger source', () => {
    const runs = [
      run({ id: 'c1', status: 'running', source: { kind: 'automation', automationId: 'auto-1' } }),
      run({ id: 'w1', status: 'running', source: { kind: 'webui' } }),
    ];
    const automationOnly = filterRunsForBoard(runs, {
      searchQuery: '',
      workflowFilterId: '',
      triggerFilter: 'automation',
    });
    expect(automationOnly.map((item) => item.id)).toEqual(['c1']);
  });

  it('does not cap succeeded runs in the board model', () => {
    const runs = Array.from({ length: 25 }, (_, index) =>
      run({
        id: `s${index}`,
        status: 'succeeded',
        completedAtMs: now - index * 1_000,
      }),
    );
    const succeeded = buildWorkflowBoardColumns(runs, now).find((c) => c.id === 'succeeded');
    expect(succeeded?.runs).toHaveLength(25);
    expect(succeeded).not.toHaveProperty('hiddenByCap');
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
