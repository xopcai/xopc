import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commandTask, fetchTask, type TaskDetail } from './home-api';
import { retryHomeTask } from './home-task-actions';

vi.mock('./home-api', () => ({ commandTask: vi.fn(), fetchTask: vi.fn() }));

function taskRun(overrides: Partial<TaskDetail['runs'][number]> = {}): TaskDetail['runs'][number] {
  return {
    id: 'root', taskId: 'task-1', rootRunId: 'root', attempt: 1,
    status: 'failed', executorKind: 'agent', executorRef: { agentId: 'main' },
    trigger: {}, correlationId: 'correlation-1', idempotencyKey: 'run-1',
    contractVersion: 1, queuedAt: 1, completedAt: 4, retryPolicy: {}, version: 1,
    ...overrides,
  };
}

function taskDetail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    ok: true,
    task: {
      id: 'task-1', title: 'Chart', phase: 'active', priority: 'normal', source: 'user',
      latestContractVersion: 1, boardRank: 0, version: 7, createdAt: 0, updatedAt: 4,
    },
    operationalState: 'idle', attention: [], waits: [], runs: [], receipts: [],
    criterionReviews: [], context: [], sessions: [], authorityGrants: [], dependencies: [], dependents: [],
    conversation: { taskId: 'task-1', assignmentEpoch: 0, status: 'idle', updatedAt: 4 },
    allowedCommands: ['start'],
    ...overrides,
  };
}

describe('retryHomeTask', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('uses the latest root executor and current task version', async () => {
    vi.mocked(fetchTask).mockResolvedValue(taskDetail({
      runs: [
        taskRun({ id: 'child', queuedAt: 3, parentRunId: 'root' }),
        taskRun({ queuedAt: 2, executorKind: 'workflow', executorRef: { workflowId: 'chart', input: { symbol: 'ABC' } } }),
        taskRun({ id: 'old', rootRunId: 'old', executorRef: { agentId: 'old' } }),
      ],
    }));
    await retryHomeTask('task-1');
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'start', executor: { kind: 'workflow', workflowId: 'chart', input: { symbol: 'ABC' } } }, 7);
  });
  it.each([
    { allowedCommands: [], runs: [taskRun()] },
    { allowedCommands: ['start'], runs: [taskRun({ status: 'succeeded', startedAt: 2, contextSnapshotId: 'context-1', policySnapshot: {} })] },
  ])('rejects a stale retry after task state changed', async (state) => {
    vi.mocked(fetchTask).mockResolvedValue(taskDetail(state));
    await expect(retryHomeTask('task-1')).rejects.toThrow('no longer available');
    expect(commandTask).not.toHaveBeenCalled();
  });
});
