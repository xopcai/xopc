import { describe, expect, it } from 'vitest';

import type { TaskDetail } from '@/features/tasks/home-api';
import { hasTaskEditConflict, optimisticallyPatchTask } from '@/features/tasks/task-detail-sync';
import { taskDetailSWRKey } from '@/features/tasks/use-task-detail';

describe('task detail synchronization', () => {
  it('only reports a conflict when both the server and the draft changed the same field', () => {
    const base = { value: 'Original', version: 1 };
    expect(hasTaskEditConflict(base, 2, 'Original', 'My draft')).toBe(false);
    expect(hasTaskEditConflict(base, 2, 'Agent title', 'Agent title')).toBe(false);
    expect(hasTaskEditConflict(base, 2, 'Agent title', 'My draft')).toBe(true);
  });

  it('applies a local patch without mutating the cached detail', () => {
    const detail = {
      task: {
        id: 'task-1',
        title: 'Original',
        body: 'Body',
        phase: 'ready',
        priority: 'normal',
        source: 'api',
        latestContractVersion: 1,
        boardRank: 1,
        version: 3,
        createdAt: 1,
        updatedAt: 1,
      },
    } as TaskDetail;
    const updated = optimisticallyPatchTask(detail, { title: 'Updated', body: null });

    expect(updated.task).toMatchObject({ title: 'Updated', version: 4 });
    expect(updated.task.body).toBeUndefined();
    expect(detail.task).toMatchObject({ title: 'Original', body: 'Body', version: 3 });
  });

  it('keeps task reads available when gateway authentication is disabled', () => {
    expect(taskDetailSWRKey('task-1', undefined)).toEqual(['task-detail', 'task-1', '']);
    expect(taskDetailSWRKey('', undefined)).toBeNull();
  });
});
