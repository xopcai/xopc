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
import { getWorkUnderstandingThread, upsertWorkUnderstandingThread } from '../../work-discovery/thread-repository.js';
import { FocusService } from '../focus-service.js';

describe('FocusService', () => {
  let stateDir: string;
  const create = vi.fn();
  const pause = vi.fn();
  const resume = vi.fn();
  const update = vi.fn();
  const runNow = vi.fn();

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-focus-service-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    create.mockReset().mockImplementation(async (input: Partial<Automation>) => {
      const now = Date.now();
      const automation = {
        ...input,
        id: 'automation-1',
        enabled: true,
        state: {},
        createdAtMs: now,
        updatedAtMs: now,
      } as Automation;
      saveAutomation(automation);
      return automation;
    });
    pause.mockReset().mockResolvedValue({ id: 'automation-1' } as Automation);
    resume.mockReset().mockResolvedValue({ id: 'automation-1' } as Automation);
    update.mockReset().mockResolvedValue({ id: 'automation-1' } as Automation);
    runNow.mockReset().mockResolvedValue({ id: 'run-1' } as AutomationRun);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('confirms a thread and creates one idempotent seven-day progress watch', async () => {
    const thread = upsertWorkUnderstandingThread({
      canonicalKey: 'ship-desktop',
      title: 'Ship the desktop app',
      summary: 'Finish onboarding and validate the packaged application.',
      status: 'active',
      horizon: 'current',
      focusScore: 90,
      confidence: 0.9,
      projectIds: [],
      evidenceIds: [],
    });
    const service = new FocusService({ create, pause, resume, update, runNow });

    expect(service.list()).toEqual([]);
    const first = await service.activateTrial({ threadId: thread.id });
    const second = await service.activateTrial({ threadId: thread.id });

    expect(getWorkUnderstandingThread(thread.id)?.userStatus).toBe('confirmed');
    expect(first.watch).toMatchObject({ kind: 'progress', status: 'active', automationId: 'automation-1' });
    expect(first.watch.trialEndsAt).toBeGreaterThan(Date.now());
    expect(second.watch.id).toBe(first.watch.id);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      safety: { mode: 'suggest_only' },
      trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMs: 86_400_000 } },
    }));
    expect(runNow).toHaveBeenCalledTimes(1);
  });

  it('pauses both the watch and its automation', async () => {
    const thread = upsertWorkUnderstandingThread({
      canonicalKey: 'prepare-launch',
      title: 'Prepare launch',
      summary: 'Prepare the launch checklist.',
      status: 'active',
      horizon: 'current',
      focusScore: 80,
      confidence: 0.8,
      projectIds: [],
      evidenceIds: [],
    });
    const service = new FocusService({ create, pause, resume, update, runNow });
    const { watch } = await service.activateTrial({ threadId: thread.id });

    const updated = await service.pauseWatch(watch.id);

    expect(updated?.status).toBe('paused');
    expect(pause).toHaveBeenCalledWith('automation-1');
  });

  it('pauses expired trials and starts a fresh trial when resumed', async () => {
    const thread = upsertWorkUnderstandingThread({
      canonicalKey: 'review-release',
      title: 'Review release',
      summary: 'Check the release evidence.',
      status: 'active',
      horizon: 'current',
      focusScore: 75,
      confidence: 0.75,
      projectIds: [],
      evidenceIds: [],
    });
    const service = new FocusService({ create, pause, resume, update, runNow });
    const { watch } = await service.activateTrial({ threadId: thread.id });

    await service.reconcileExpiredTrials((watch.trialEndsAt ?? 0) + 1);
    expect(service.list()[0]?.watches[0]?.status).toBe('paused');
    expect(pause).toHaveBeenCalledWith('automation-1');

    const restarted = await service.activateTrial({ threadId: thread.id });
    expect(restarted.watch.status).toBe('active');
    expect(restarted.watch.trialEndsAt).toBeGreaterThan(Date.now());
    expect(resume).toHaveBeenCalledWith('automation-1');
  });

  it('updates and immediately runs an existing deadline watch for a selected event', async () => {
    const thread = upsertWorkUnderstandingThread({
      canonicalKey: 'launch-event',
      title: 'Launch desktop',
      summary: 'Prepare the desktop launch.',
      status: 'active',
      horizon: 'current',
      focusScore: 80,
      confidence: 0.8,
      projectIds: [],
      evidenceIds: [],
    });
    const service = new FocusService({ create, pause, resume, update, runNow });
    await service.activateTrial({ threadId: thread.id, kind: 'deadline' });
    runNow.mockClear();

    await service.activateTrial({
      threadId: thread.id,
      kind: 'deadline',
      eventContext: 'Launch review at 2026-08-03T09:00:00.000Z',
    });

    expect(update).toHaveBeenCalledWith('automation-1', expect.objectContaining({
      action: expect.objectContaining({
        instruction: expect.stringContaining('Launch review at 2026-08-03T09:00:00.000Z'),
      }),
    }));
    expect(runNow).toHaveBeenCalledWith('automation-1');
  });

  it('pauses a noisy watch after three consecutive not-useful responses', async () => {
    const thread = upsertWorkUnderstandingThread({
      canonicalKey: 'noisy-focus',
      title: 'Noisy focus',
      summary: 'A focus with low-value updates.',
      status: 'active',
      horizon: 'ongoing',
      focusScore: 70,
      confidence: 0.7,
      projectIds: [],
      evidenceIds: [],
    });
    const service = new FocusService({ create, pause, resume, update, runNow });
    const { watch } = await service.activateTrial({ threadId: thread.id });

    await service.recordInsightFeedback(watch.id, false);
    await service.recordInsightFeedback(watch.id, false);
    const paused = await service.recordInsightFeedback(watch.id, false);

    expect(paused?.status).toBe('paused');
    expect(pause).toHaveBeenCalledWith('automation-1');
  });
});
