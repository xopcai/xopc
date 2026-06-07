import { describe, expect, it, vi } from 'vitest';

import { DefaultJobExecutor } from '../executor.js';
import type { JobData } from '../types.js';

function createWorkflowRunJob(): JobData {
  return {
    id: 'nightly',
    name: 'Nightly workflow',
    schedule: '0 * * * *',
    enabled: true,
    maxRetries: 0,
    timeout: 60_000,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    payload: {
      kind: 'workflowRun',
      definitionId: 'release-check',
      goal: 'Check release',
      inputEnvelope: {
        payload: { branch: 'main' },
        variables: { releaseType: 'patch' },
        context: { actor: 'cron' },
      },
      source: {
        fireId: 'fire-1',
        scheduledAtMs: 123,
      },
    },
  };
}

describe('DefaultJobExecutor workflowRun payload', () => {
  it('starts a workflow run and records workflowRunId in execution history', async () => {
    const startWorkflowRun = vi.fn(async () => ({ ok: true as const, runId: 'run-1' }));
    const executor = new DefaultJobExecutor();

    await executor.execute(createWorkflowRunJob(), new AbortController().signal, {
      getDefaultCronAgentId: () => 'main',
      workflowRunService: { startWorkflowRun },
    });

    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'main',
        definitionId: 'release-check',
        goal: 'Check release',
        inputEnvelope: {
          payload: { branch: 'main' },
          variables: { releaseType: 'patch' },
          context: { actor: 'cron' },
        },
        source: {
          kind: 'cron',
          scheduleId: 'nightly',
          fireId: 'fire-1',
          scheduledAtMs: 123,
        },
        idempotencyKey: 'cron:nightly:fire-1',
      }),
    );

    expect(executor.getHistory('nightly', 1)[0]).toMatchObject({
      status: 'success',
      workflowRunId: 'run-1',
      sessionKey: 'agent:main:cron:default:direct:nightly',
      sessionType: 'cron',
    });
  });
});
