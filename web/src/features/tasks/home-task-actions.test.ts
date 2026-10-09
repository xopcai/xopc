import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commandTask, fetchTask, type TaskDetail } from './home-api';
import { retryHomeTask } from './home-task-actions';

vi.mock('./home-api', () => ({ commandTask: vi.fn(), fetchTask: vi.fn() }));

describe('retryHomeTask', () => {
  beforeEach(() => vi.clearAllMocks());
  it('uses the latest root executor and current task version', async () => {
    vi.mocked(fetchTask).mockResolvedValue({
      task: { version: 7 }, allowedCommands: ['start'],
      runs: [
        { queuedAt: 3, parentRunId: 'root', executorKind: 'agent', status: 'failed' },
        { queuedAt: 2, executorKind: 'workflow', executorRef: { workflowId: 'chart', input: { symbol: 'ABC' } }, status: 'failed' },
        { queuedAt: 1, executorKind: 'agent', executorRef: { agentId: 'old' }, status: 'failed' },
      ],
    } as unknown as TaskDetail);
    await retryHomeTask('task-1');
    expect(commandTask).toHaveBeenCalledWith('task-1', { type: 'start', executor: { kind: 'workflow', workflowId: 'chart', input: { symbol: 'ABC' } } }, 7);
  });
  it.each([
    { allowedCommands: [], runs: [{ status: 'failed', queuedAt: 1 }] },
    { allowedCommands: ['start'], runs: [{ status: 'succeeded', queuedAt: 1 }] },
  ])('rejects a stale retry after task state changed', async (state) => {
    vi.mocked(fetchTask).mockResolvedValue({ task: { version: 8 }, ...state } as unknown as TaskDetail);
    await expect(retryHomeTask('task-1')).rejects.toThrow('no longer available');
    expect(commandTask).not.toHaveBeenCalled();
  });
});
