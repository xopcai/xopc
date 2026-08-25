import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  formatApiHttpError: vi.fn((status: number) => `HTTP ${status}`),
}));

import { apiFetch } from '../../api/client';
import {
  createScheduledAgentAutomation,
  fetchAutomations,
  fetchAutomationRuns,
  cancelAutomationRun,
  rerunAutomation,
  setAutomationEnabled,
} from '../automations';

const mockedApiFetch = vi.mocked(apiFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const automation = {
  id: 'daily-brief',
  name: 'Daily brief',
  enabled: true,
  trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * 1-5' } },
  action: { kind: 'agent', instruction: 'Summarize my inbox' },
  state: {
    nextRunAtMs: 1_800_000_000_000,
    lastRunAtMs: 1_700_000_000_000,
    lastRunStatus: 'timeout',
    lastError: 'Deadline exceeded',
  },
  createdAtMs: 1_600_000_000_000,
  updatedAtMs: 1_700_000_000_000,
} as const;

describe('automation gateway query', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('preserves automation state without adapting it to a cron job', async () => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({ automations: [automation] }));

    await expect(fetchAutomations()).resolves.toEqual([automation]);
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/automations');
  });

  it('filters automations by project', async () => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({ automations: [automation] }));

    await expect(fetchAutomations('project/one')).resolves.toEqual([automation]);
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/automations?projectId=project%2Fone');
  });

  it('creates a scheduled agent automation using the canonical API shape', async () => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({ automation }, 201));

    await expect(createScheduledAgentAutomation({
      name: ' Daily brief ',
      cronExpression: '0 9 * * 1-5',
      instruction: ' Summarize my inbox ',
    })).resolves.toEqual(automation);
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/automations', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Daily brief',
        enabled: true,
        trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * 1-5' } },
        action: { kind: 'agent', instruction: 'Summarize my inbox' },
        afterRun: { kind: 'saveToSession' },
      }),
    });
  });

  it('uses pause and resume endpoints without changing the data model', async () => {
    mockedApiFetch.mockImplementation(async () => jsonResponse({ automation }));

    await setAutomationEnabled('job/id', false);
    await setAutomationEnabled('job/id', true);

    expect(mockedApiFetch).toHaveBeenNthCalledWith(1, '/api/automations/job%2Fid/pause', { method: 'POST' });
    expect(mockedApiFetch).toHaveBeenNthCalledWith(2, '/api/automations/job%2Fid/resume', { method: 'POST' });
  });

  it('preserves queued and timeout run statuses', async () => {
    const baseRun = {
      automationId: automation.id,
      automationName: automation.name,
      triggerSnapshot: automation.trigger,
      actionSnapshot: automation.action,
      manual: false,
      createdAtMs: 1_700_000_000_000,
    };
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({
      runs: [
        { ...baseRun, id: 'queued-run', status: 'queued' },
        { ...baseRun, id: 'timeout-run', status: 'timeout', error: 'Deadline exceeded' },
      ],
    }));

    await expect(fetchAutomationRuns(25)).resolves.toMatchObject([
      { id: 'queued-run', status: 'queued' },
      { id: 'timeout-run', status: 'timeout' },
    ]);
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/automation-runs?limit=25');
  });

  it('filters runs by automation without changing the returned run contract', async () => {
    mockedApiFetch.mockResolvedValueOnce(jsonResponse({ runs: [] }));
    await expect(fetchAutomationRuns(10, 'daily/brief')).resolves.toEqual([]);
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/automation-runs?limit=10&automationId=daily%2Fbrief');
  });

  it('supports canonical rerun and cancel operations', async () => {
    const run = {
      id: 'rerun-1',
      automationId: automation.id,
      automationName: automation.name,
      status: 'queued',
      triggerSnapshot: automation.trigger,
      actionSnapshot: automation.action,
      manual: true,
      createdAtMs: 1_700_000_000_000,
    } as const;
    mockedApiFetch
      .mockResolvedValueOnce(jsonResponse({ run }, 201))
      .mockResolvedValueOnce(jsonResponse({ cancelled: true }));

    await expect(rerunAutomation('failed/run')).resolves.toEqual(run);
    await expect(cancelAutomationRun('running/run')).resolves.toBe(true);
    expect(mockedApiFetch).toHaveBeenNthCalledWith(1, '/api/automation-runs/failed%2Frun/rerun', { method: 'POST' });
    expect(mockedApiFetch).toHaveBeenNthCalledWith(2, '/api/automation-runs/running%2Frun/cancel', { method: 'POST' });
  });
});
