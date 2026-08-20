import { describe, expect, it } from 'vitest';

import {
  TaskRunSchema,
} from './task-runs.js';
import { TaskWaitSchema } from './task-lifecycle.js';

describe('TaskRun contracts', () => {
  it('accepts a queued root run without dispatch snapshots', () => {
    const run = TaskRunSchema.parse({
      id: 'run-1',
      taskId: 'task-1',
      rootRunId: 'run-1',
      attempt: 1,
      status: 'queued',
      executorKind: 'agent',
      executorRef: { agentId: 'main' },
      trigger: { kind: 'user' },
      correlationId: 'correlation-1',
      idempotencyKey: 'command-1',
      contractVersion: 1,
      queuedAt: 1,
      retryPolicy: { maxAttempts: 3 },
      version: 1,
    });

    expect(run.rootRunId).toBe(run.id);
    expect(run.contextSnapshotId).toBeUndefined();
  });

  it('models waiting as a structured record', () => {
    const wait = TaskWaitSchema.parse({
      id: 'wait-1',
      taskId: 'task-1',
      taskRunId: 'run-1',
      kind: 'approval',
      status: 'active',
      reason: 'Approve public publishing',
      condition: { boundary: 'publish' },
      createdAt: 1,
    });

    expect(wait.kind).toBe('approval');
    expect(wait.condition).toEqual({ boundary: 'publish' });
  });

  it('rejects a legacy task status as a run status', () => {
    expect(() => TaskRunSchema.parse({
      id: 'run-1',
      taskId: 'task-1',
      rootRunId: 'run-1',
      attempt: 1,
      status: 'waiting_dependency',
      executorKind: 'agent',
      executorRef: {},
      trigger: {},
      correlationId: 'correlation-1',
      idempotencyKey: 'command-1',
      contractVersion: 1,
      queuedAt: 1,
      retryPolicy: {},
      version: 1,
    })).toThrow();
  });

  it('requires immutable dispatch snapshots after queueing', () => {
    expect(() => TaskRunSchema.parse({
      id: 'run-1',
      taskId: 'task-1',
      rootRunId: 'run-1',
      attempt: 1,
      status: 'running',
      executorKind: 'agent',
      executorRef: {},
      trigger: {},
      correlationId: 'correlation-1',
      idempotencyKey: 'command-1',
      contractVersion: 1,
      queuedAt: 1,
      startedAt: 2,
      retryPolicy: {},
      version: 1,
    })).toThrow('A dispatched run requires context and policy snapshots');
  });
});
