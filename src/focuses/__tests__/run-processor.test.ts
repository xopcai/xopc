import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Automation, AutomationRun } from '../../automations/index.js';
import { saveAutomation } from '../../automations/storage/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { listFocusInsights } from '../insight-repository.js';
import { createFocus, upsertFocusMonitor } from '../repository.js';
import { parseFocusMonitorResult, processFocusMonitorRun } from '../run-processor.js';

describe('focus monitor run processor', () => {
  let stateDir: string;
  let focusId: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-focus-run-v2-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    const automation = automationFixture();
    saveAutomation(automation);
    focusId = createFocus({ title: 'Release', summary: 'Validate release.' }).id;
    upsertFocusMonitor({
      focusId,
      kind: 'progress',
      enabled: true,
      runState: 'running',
      cadence: { kind: 'interval', everyMs: 86_400_000 },
      automationId: automation.id,
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('parses only complete evidence-backed output', () => {
    expect(parseFocusMonitorResult('{"meaningful":false}')).toEqual({ meaningful: false });
    expect(parseFocusMonitorResult('{"meaningful":true,"title":"Changed"}')).toBeNull();
  });

  it('creates one insight and processes duplicate completion once', () => {
    const run = completedRun('run-1', JSON.stringify({
      meaningful: true,
      title: 'Checks passed',
      summary: 'Packaging now passes.',
      whyItMatters: 'Release is unblocked.',
      nextAction: 'Run installer smoke test.',
      evidence: [{ label: '24 tests passed', source: 'test output' }],
    }));

    expect(processFocusMonitorRun(run).insight).toMatchObject({ title: 'Checks passed' });
    expect(processFocusMonitorRun(run)).toEqual({ handled: true });
    expect(listFocusInsights({ focusId })).toHaveLength(1);
  });

  function automationFixture(): Automation {
    const now = Date.now();
    return {
      id: 'automation-1',
      name: 'Monitor focus',
      enabled: true,
      trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'Monitor.' },
      safety: { mode: 'suggest_only' },
      afterRun: { kind: 'none' },
      state: {},
      createdAtMs: now,
      updatedAtMs: now,
    };
  }

  function completedRun(id: string, summary: string): AutomationRun {
    const now = Date.now();
    return {
      id,
      automationId: 'automation-1',
      automationName: 'Monitor focus',
      status: 'succeeded',
      triggerSnapshot: { kind: 'manual' },
      actionSnapshot: { kind: 'agent', instruction: 'Monitor.' },
      manual: false,
      createdAtMs: now - 10,
      startedAtMs: now - 5,
      endedAtMs: now,
      durationMs: 5,
      summary,
    };
  }
});
