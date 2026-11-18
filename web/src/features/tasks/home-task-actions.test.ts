import { beforeEach, describe, expect, it, vi } from 'vitest';

import { retryTask, fetchTask, type TaskDetail } from './home-api';
import { retryHomeTask } from './home-task-actions';

vi.mock('./home-api', () => ({ retryTask: vi.fn(), fetchTask: vi.fn() }));

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
    phaseChanges: [],
    task: {
      id: 'task-1', title: 'Chart', phase: 'active', priority: 'normal', source: 'user',
      latestContractVersion: 1, boardRank: 0, version: 7, createdAt: 0, updatedAt: 4,
    },
    operationalState: 'idle', attention: [], waits: [], runs: [], receipts: [],
    presentation: { status: 'failed', primaryAction: { type: 'retry_run', runId: 'root' } },
    criterionReviews: [], acceptanceChecks: [], results: [], context: [], sessions: [], authorityGrants: [], dependencies: [], dependents: [],
    conversation: { taskId: 'task-1', assignmentEpoch: 0, status: 'idle', updatedAt: 4 },
    allowedCommands: ['start'],
    ...overrides,
  };
}

describe('retryHomeTask', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('sends the failed root run to the shared retry endpoint', async () => {
    vi.mocked(fetchTask).mockResolvedValue(taskDetail({
      runs: [
        taskRun({ id: 'child', queuedAt: 3, parentRunId: 'root' }),
        taskRun({ queuedAt: 2, executorKind: 'agent', executorRef: { agentId: 'main' } }),
        taskRun({ id: 'old', rootRunId: 'old', executorRef: { agentId: 'old' } }),
      ],
    }));
    await retryHomeTask('task-1');
    expect(retryTask).toHaveBeenCalledWith('task-1', 'root');
  });
  it('rejects a card whose current presentation no longer offers retry', async () => {
    vi.mocked(fetchTask).mockResolvedValue(taskDetail({ presentation: { status: 'running' } }));
    await expect(retryHomeTask('task-1')).rejects.toThrow('no longer available');
    expect(retryTask).not.toHaveBeenCalled();
  });
});
