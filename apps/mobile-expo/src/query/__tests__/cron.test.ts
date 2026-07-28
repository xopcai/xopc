import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  formatApiHttpError: vi.fn((status: number) => `HTTP ${status}`),
}));

import { apiFetch } from '../../api/client';
import {
  createCronJob,
  fetchCronJobs,
  fetchCronRunsHistory,
  toggleCronJob,
} from '../cron';

const mockedApiFetch = vi.mocked(apiFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('cron automation gateway adapter', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('loads current automations and adapts scheduled agent actions', async () => {
    mockedApiFetch.mockResolvedValueOnce(
      jsonResponse({
        automations: [
          {
            id: 'daily-brief',
            name: 'Daily brief',
            enabled: true,
            trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * 1-5' } },
            action: { kind: 'agent', instruction: 'Summarize my inbox' },
            state: { nextRunAtMs: 1_800_000_000_000 },
          },
        ],
      }),
    );

    await expect(fetchCronJobs()).resolves.toEqual([
      {
        id: 'daily-brief',
        name: 'Daily brief',
        enabled: true,
        schedule: '0 9 * * 1-5',
        payload: { kind: 'agentTurn', message: 'Summarize my inbox' },
        next_run: new Date(1_800_000_000_000).toISOString(),
      },
    ]);
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/automations');
  });

  it('creates a scheduled automation with the current API shape', async () => {
    mockedApiFetch.mockResolvedValueOnce(
      jsonResponse({
        automation: {
          id: 'created-id',
          name: 'Morning note',
          enabled: true,
          trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 8 * * *' } },
          action: { kind: 'agent', instruction: 'Prepare my note' },
          state: {},
        },
      }, 201),
    );

    await expect(
      createCronJob({ name: ' Morning note ', schedule: '0 8 * * *', message: ' Prepare my note ' }),
    ).resolves.toEqual({ id: 'created-id' });
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/automations', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Morning note',
        enabled: true,
        trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 8 * * *' } },
        action: { kind: 'agent', instruction: 'Prepare my note' },
        afterRun: { kind: 'saveToSession' },
      }),
    });
  });

  it('uses pause and resume endpoints when toggling', async () => {
    mockedApiFetch.mockResolvedValue(jsonResponse({}));

    await toggleCronJob('job/id', false);
    await toggleCronJob('job/id', true);

    expect(mockedApiFetch).toHaveBeenNthCalledWith(1, '/api/automations/job%2Fid/pause', { method: 'POST' });
    expect(mockedApiFetch).toHaveBeenNthCalledWith(2, '/api/automations/job%2Fid/resume', { method: 'POST' });
  });

  it('loads and adapts current automation run statuses', async () => {
    mockedApiFetch.mockResolvedValueOnce(
      jsonResponse({
        runs: [
          {
            id: 'run-1',
            automationId: 'daily-brief',
            automationName: 'Daily brief',
            status: 'succeeded',
            createdAtMs: 1_700_000_000_000,
            startedAtMs: 1_700_000_001_000,
            endedAtMs: 1_700_000_002_000,
            durationMs: 1_000,
            summary: 'Done',
            sessionKey: 'agent:main:automation:run-1',
          },
        ],
      }),
    );

    await expect(fetchCronRunsHistory(25)).resolves.toEqual([
      {
        id: 'run-1',
        jobId: 'daily-brief',
        jobName: 'Daily brief',
        status: 'success',
        startedAt: new Date(1_700_000_001_000).toISOString(),
        endedAt: new Date(1_700_000_002_000).toISOString(),
        duration: 1_000,
        error: undefined,
        summary: 'Done',
        sessionKey: 'agent:main:automation:run-1',
      },
    ]);
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/automation-runs?limit=25');
  });
});
