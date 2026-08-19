import { describe, expect, it } from 'vitest';

import type { Task } from '@xopcai/gateway-contract';
import type { TaskRuntime } from '../task-repository.js';
import { decisionFromTask } from '../home-query-service.js';

function task(patch: Partial<Task> = {}): Task {
  return {
    id: 'task/1',
    objective: 'Review the blocked task',
    status: 'blocked',
    priority: 'normal',
    latestContractVersion: 1,
    createdAt: 1,
    updatedAt: 2,
    ...patch,
  };
}

const execution: TaskRuntime = {
  taskId: 'task/1', agentId: 'main', priority: 'normal', source: 'api',
  createdAt: 1, updatedAt: 2, blockedReason: 'Needs approval',
};

describe('decisionFromTask', () => {
  it('links task decisions to the user-facing task route', () => {
    expect(decisionFromTask(task(), execution)?.href).toBe('/tasks/task%2F1');
  });

  it('omits tasks that do not need user input', () => {
    expect(decisionFromTask(task({ status: 'running' }), execution)).toBeNull();
  });
});
