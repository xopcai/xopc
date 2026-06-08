import { describe, expect, it, vi } from 'vitest';

import { DefaultJobExecutor } from '../executor.js';
import type { JobData } from '../types.js';

function createWorkflowRunJob(overrides: Partial<JobData> = {}): JobData {
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
    ...overrides,
  };
}

function failedView() {
  return {
    run: {
      id: 'run-1',
      definitionId: 'release-check',
      definitionVersion: '1',
      title: 'Release Check',
      goal: 'Check release',
      input: {},
      status: 'failed' as const,
      source: { kind: 'cron' as const, scheduleId: 'nightly' },
      metrics: {
        agentCount: 1,
        doneAgentCount: 0,
        errorAgentCount: 1,
        skippedAgentCount: 0,
        artifactCount: 0,
      },
      createdAtMs: 1,
    },
    phases: [],
    agents: [],
    logs: [],
    artifacts: [],
    timeline: [],
    controls: { canCancel: false, canRetry: false, canArchive: false },
  };
}

function succeededView() {
  return {
    run: {
      id: 'run-1',
      definitionId: 'release-check',
      definitionVersion: '1',
      title: 'Release Check',
      goal: 'Check release',
      input: {},
      status: 'succeeded' as const,
      source: { kind: 'cron' as const, scheduleId: 'nightly' },
      metrics: {
        agentCount: 1,
        doneAgentCount: 1,
        errorAgentCount: 0,
        skippedAgentCount: 0,
        artifactCount: 0,
      },
      createdAtMs: 1,
    },
    phases: [],
    agents: [],
    logs: [],
    artifacts: [],
    timeline: [],
    controls: { canCancel: false, canRetry: false, canArchive: false },
  };
}

describe('DefaultJobExecutor workflowRun payload', () => {
  it('waits for terminal status and records workflow outcome', async () => {
    const startWorkflowRun = vi.fn(async () => ({
      ok: true as const,
      runId: 'run-1',
      sessionKey: 'agent:main:webchat:default:direct:wf_run-1',
    }));
    const readWorkflowRunView = vi.fn(async () => succeededView());
    const executor = new DefaultJobExecutor();

    await executor.execute(createWorkflowRunJob(), new AbortController().signal, {
      getDefaultCronAgentId: () => 'main',
      workflowRunService: { startWorkflowRun, readWorkflowRunView },
    });

    expect(startWorkflowRun).toHaveBeenCalled();
    expect(readWorkflowRunView).toHaveBeenCalled();

    expect(executor.getHistory('nightly', 1)[0]).toMatchObject({
      status: 'success',
      workflowRunId: 'run-1',
      sessionKey: 'agent:main:webchat:default:direct:wf_run-1',
      sessionType: 'workflow',
      summary: expect.stringContaining('succeeded'),
    });
  });

  it('retries failed workflow runs when maxRetries allows', async () => {
    let readCalls = 0;
    const startWorkflowRun = vi.fn(async () => ({
      ok: true as const,
      runId: 'run-1',
      sessionKey: 'agent:main:webchat:default:direct:wf_run-1',
    }));
    const readWorkflowRunView = vi.fn(async () => {
      readCalls += 1;
      return readCalls === 1 ? failedView() : succeededView();
    });
    const retryWorkflowRun = vi.fn(async () => ({
      ok: true as const,
      runId: 'run-2',
      sessionKey: 'agent:main:webchat:default:direct:wf_run-2',
    }));
    const executor = new DefaultJobExecutor();

    await executor.execute(
      createWorkflowRunJob({ maxRetries: 1 }),
      new AbortController().signal,
      {
        getDefaultCronAgentId: () => 'main',
        workflowRunService: { startWorkflowRun, readWorkflowRunView, retryWorkflowRun },
      },
    );

    expect(retryWorkflowRun).toHaveBeenCalledWith({ agentId: 'main', runId: 'run-1' });
    expect(executor.getHistory('nightly', 1)[0]).toMatchObject({
      status: 'success',
      workflowRunId: 'run-2',
      summary: expect.stringContaining('succeeded'),
    });
  });

  it('can fire-and-forget when waitForCompletion is false', async () => {
    const startWorkflowRun = vi.fn(async () => ({
      ok: true as const,
      runId: 'run-1',
      sessionKey: 'agent:main:webchat:default:direct:wf_run-1',
    }));
    const readWorkflowRunView = vi.fn();
    const executor = new DefaultJobExecutor();

    await executor.execute(
      createWorkflowRunJob({
        payload: {
          kind: 'workflowRun',
          definitionId: 'release-check',
          waitForCompletion: false,
        },
      }),
      new AbortController().signal,
      {
        getDefaultCronAgentId: () => 'main',
        workflowRunService: { startWorkflowRun, readWorkflowRunView },
      },
    );

    expect(readWorkflowRunView).not.toHaveBeenCalled();
    expect(executor.getHistory('nightly', 1)[0]).toMatchObject({
      status: 'success',
      summary: 'Started workflow run run-1',
    });
  });
});
