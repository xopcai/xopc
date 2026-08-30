import { describe, expect, it } from 'vitest';

import {
  TaskCreateRequestSchema,
  TaskChangedEventSchema,
  TaskDeletedEventSchema,
  TaskSchema,
} from './tasks.js';

describe('Task contracts', () => {
  it('allows capture without creating an execution contract alias', () => {
    const request = TaskCreateRequestSchema.parse({
      idempotencyKey: '70ef31fc-cb6c-4c5e-986f-85693256c74b',
      title: 'Prepare release',
      contract: {
        objective: 'Publish the release',
        expectedOutputs: [],
        acceptanceCriteria: [],
        constraints: [],
        approvalRequired: [],
        assumptions: [],
        risks: [],
        acceptancePolicy: 'verified_then_review',
        outputDestinations: [],
      },
      activation: { mode: 'capture' },
    });

    expect(request.activation).toEqual({ mode: 'capture', phase: 'backlog' });
  });

  it('enforces phase and resolution as one invariant', () => {
    const base = {
      id: 'task-1',
      title: 'Prepare release',
      phase: 'closed',
      priority: 'normal',
      source: 'api',
      latestContractVersion: 1,
      boardRank: 1024,
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    };

    expect(() => TaskSchema.parse(base)).toThrow();
    expect(TaskSchema.parse({ ...base, resolution: 'done' }).resolution).toBe('done');
  });

  it('normalizes an omitted board position in task read payloads', () => {
    const task = TaskSchema.parse({
      id: 'task-1',
      title: 'Task',
      phase: 'ready',
      priority: 'normal',
      source: 'api',
      latestContractVersion: 1,
      version: 1,
      createdAt: 10,
      updatedAt: 10,
    });

    expect(task.boardRank).toBe(0);
  });

  it('rejects the removed status and objective-only create contract', () => {
    expect(() => TaskCreateRequestSchema.parse({
      requestId: '70ef31fc-cb6c-4c5e-986f-85693256c74b',
      mode: 'capture',
      objective: 'Legacy create',
    })).toThrow();
  });

  it('validates versioned task change notifications', () => {
    expect(TaskChangedEventSchema.parse({
      taskId: 'task-1',
      version: 2,
      changedFields: ['phase', 'receipts'],
      source: 'agent',
      actorId: 'main',
      occurredAt: 10,
    })).toMatchObject({ taskId: 'task-1', version: 2, source: 'agent' });
    expect(() => TaskChangedEventSchema.parse({
      taskId: 'task-1',
      version: 2,
      changedFields: ['unknown'],
      source: 'agent',
      occurredAt: 10,
    })).toThrow();
  });

  it('validates task deletion notifications', () => {
    expect(TaskDeletedEventSchema.parse({
      taskId: 'task-1',
      projectId: 'project-1',
      deletedAt: 10,
    })).toEqual({ taskId: 'task-1', projectId: 'project-1', deletedAt: 10 });
  });
});
