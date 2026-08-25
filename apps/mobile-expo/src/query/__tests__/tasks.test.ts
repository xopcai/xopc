import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchTask, fetchTasks, TaskApiError } from '../tasks';

vi.mock('../../api/client', () => ({ apiFetch: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);

const taskWithoutBoardPosition = {
  id: 'task-1',
  title: 'Task',
  phase: 'ready',
  priority: 'normal',
  source: 'api',
  latestContractVersion: 1,
  version: 1,
  createdAt: 10,
  updatedAt: 10,
};

describe('task queries', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('encodes task ids', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: 'Task not found',
    }), { status: 404 }));

    await expect(fetchTask('task/1')).rejects.toMatchObject({
      name: 'TaskApiError',
      status: 404,
      message: 'Task not found',
    });
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/tasks/task%2F1');
  });

  it('preserves conflict codes from the gateway', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      code: 'version_conflict',
      error: 'Task changed',
    }), { status: 409 }));

    const error = await fetchTasks().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TaskApiError);
    expect(error).toMatchObject({ status: 409, code: 'version_conflict', message: 'Task changed' });
  });

  it('loads the work overview when task board positioning is omitted', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      items: [{ task: taskWithoutBoardPosition, operationalState: 'idle', attention: [] }],
    })));

    await expect(fetchTasks()).resolves.toMatchObject([{ task: { id: 'task-1', boardRank: 0 } }]);
  });

  it('loads task details when task board positioning is omitted', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      task: taskWithoutBoardPosition,
      operationalState: 'idle',
      attention: [],
      waits: [],
      runs: [],
      receipts: [],
      context: [],
      authorityGrants: [],
      dependencies: [],
      dependents: [],
      allowedCommands: [],
    })));

    await expect(fetchTask('task-1')).resolves.toMatchObject({ task: { id: 'task-1', boardRank: 0 } });
  });
});
