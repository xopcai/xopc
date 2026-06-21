import { describe, expect, it } from 'vitest';

import { AddJobRequestSchema, JobDataSchema, UpdateJobRequestSchema } from '../validation.js';

describe('cron validation agentId', () => {
  const baseJob = {
    id: 'abc12345',
    schedule: '0 * * * *',
    enabled: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    payload: { kind: 'agentTurn' as const, message: 'hi' },
  };

  it('JobDataSchema accepts optional agentId', () => {
    const r = JobDataSchema.safeParse({ ...baseJob, agentId: 'research' });
    expect(r.success).toBe(true);
  });

  it('AddJobRequestSchema accepts agentId', () => {
    const r = AddJobRequestSchema.safeParse({
      schedule: '0 * * * *',
      agentId: 'main',
      payload: { kind: 'agentTurn', message: 'x' },
    });
    expect(r.success).toBe(true);
  });

  it('UpdateJobRequestSchema accepts agentId null to clear', () => {
    const r = UpdateJobRequestSchema.safeParse({ agentId: null });
    expect(r.success).toBe(true);
  });

  it('AddJobRequestSchema accepts workflowRun payload', () => {
    const r = AddJobRequestSchema.safeParse({
      schedule: '0 * * * *',
      payload: {
        kind: 'workflowRun',
        definitionId: 'release-check',
        goal: 'Check release',
        inputEnvelope: {
          payload: { branch: 'main' },
          variables: { releaseType: 'patch' },
          context: { actor: 'cron' },
        },
      },
    });
    expect(r.success).toBe(true);
  });

  it('AddJobRequestSchema accepts goalContinue payload', () => {
    const r = AddJobRequestSchema.safeParse({
      schedule: '*/15 * * * *',
      payload: {
        kind: 'goalContinue',
        goalId: 'goal-1',
        message: 'Continue from the latest blocker',
        maxRetries: 2,
      },
    });
    expect(r.success).toBe(true);
  });
});
