import { describe, expect, it } from 'vitest';

import {
  TaskCreateRequestSchema,
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

  it('rejects the removed status and objective-only create contract', () => {
    expect(() => TaskCreateRequestSchema.parse({
      requestId: '70ef31fc-cb6c-4c5e-986f-85693256c74b',
      mode: 'capture',
      objective: 'Legacy create',
    })).toThrow();
  });
});
