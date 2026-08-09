import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Automation, AutomationRun } from '../../automations/index.js';
import { saveAutomation } from '../../automations/storage/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { listFocusActivities } from '../repository.js';
import { FocusService } from '../service.js';

describe('FocusService', () => {
  let stateDir: string;
  const create = vi.fn();
  const get = vi.fn();
  const update = vi.fn();
  const pause = vi.fn();
  const resume = vi.fn();
  const remove = vi.fn();
  const runNow = vi.fn();

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-focus-service-v2-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    const automation = automationFixture();
    create.mockReset().mockImplementation(async () => {
      saveAutomation(automation);
      return automation;
    });
    get.mockReset().mockResolvedValue(automation);
    update.mockReset().mockResolvedValue(automation);
    pause.mockReset().mockResolvedValue({ ...automation, enabled: false });
    resume.mockReset().mockResolvedValue(automation);
    remove.mockReset().mockResolvedValue(true);
    runNow.mockReset().mockResolvedValue(runFixture());
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('enables one idempotent monitor and starts an observable initial run', async () => {
    const service = serviceFixture();
    const focus = service.create({ title: 'Gateway billing', summary: 'Build quota support.' });

    const first = await service.configureMonitor({ focusId: focus.id, kind: 'progress', enabled: true });
    const second = await service.configureMonitor({ focusId: focus.id, kind: 'progress', enabled: true });

    expect(first).toMatchObject({ monitor: { enabled: true, runState: 'running' }, initialRunId: 'run-1' });
    expect(second.monitor.id).toBe(first.monitor.id);
    expect(create).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
    expect(runNow).toHaveBeenCalledTimes(1);
    expect(listFocusActivities({ focusId: focus.id }).map((item) => item.type))
      .toEqual(expect.arrayContaining(['monitor_enabled', 'run_started']));
  });

  it('pauses and completes a focus without losing history', async () => {
    const service = serviceFixture();
    const focus = service.create({ title: 'OAuth scopes', summary: 'Review account summaries.' });
    await service.configureMonitor({ focusId: focus.id, kind: 'external_changes', enabled: true });

    expect(await service.setStatus(focus.id, 'paused')).toMatchObject({ status: 'paused' });
    expect(pause).toHaveBeenCalledWith('automation-1');
    expect(await service.setStatus(focus.id, 'active')).toMatchObject({ status: 'active' });
    expect(await service.setStatus(focus.id, 'completed')).toMatchObject({
      status: 'completed',
      monitors: [expect.objectContaining({ enabled: false })],
    });
    expect(remove).toHaveBeenCalledWith('automation-1');
    expect(listFocusActivities({ focusId: focus.id }).map((item) => item.type))
      .toEqual(expect.arrayContaining(['paused', 'resumed', 'completed']));
  });

  it('removes automation state before deleting a focus', async () => {
    const service = serviceFixture();
    const focus = service.create({ title: 'Upstream pool', summary: 'Implement routing pools.' });
    await service.configureMonitor({ focusId: focus.id, kind: 'progress', enabled: true });

    expect(await service.remove(focus.id)).toBe(true);
    expect(remove).toHaveBeenCalledWith('automation-1');
    expect(service.get(focus.id)).toBeNull();
  });

  function serviceFixture(): FocusService {
    return new FocusService({ create, get, update, pause, resume, remove, runNow });
  }

  function automationFixture(): Automation {
    const now = Date.now();
    return {
      id: 'automation-1',
      name: 'Monitor focus',
      enabled: true,
      trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMs: 86_400_000 } },
      action: { kind: 'agent', instruction: 'Monitor focus.' },
      safety: { mode: 'suggest_only' },
      afterRun: { kind: 'none' },
      state: { nextRunAtMs: now + 86_400_000 },
      createdAtMs: now,
      updatedAtMs: now,
    };
  }

  function runFixture(): AutomationRun {
    const now = Date.now();
    return {
      id: 'run-1',
      automationId: 'automation-1',
      automationName: 'Monitor focus',
      status: 'running',
      triggerSnapshot: { kind: 'manual' },
      actionSnapshot: { kind: 'agent', instruction: 'Monitor focus.' },
      manual: true,
      createdAtMs: now,
      startedAtMs: now,
    };
  }
});
