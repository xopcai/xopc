import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchTask, fetchTasks, TaskApiError } from '../tasks';

vi.mock('../../api/client', () => ({ apiFetch: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);

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
});
