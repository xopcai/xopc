import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Automation, AutomationRun } from '../../automations/index.js';
import { saveAutomation, saveAutomationRun } from '../../automations/storage/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { upsertWorkUnderstandingThread } from '../../work-discovery/thread-repository.js';
import { listProactiveInsights } from '../insight-repository.js';
import {
  hasValidIntelligenceEvidence,
  parseFocusRunResult,
  processFocusAutomationRun,
} from '../run-processor.js';
import { createFocusWatch, getFocusWatchByAutomationId } from '../watch-repository.js';

describe('focus automation result processing', () => {
  let stateDir: string;
  const automationId = 'focus-automation';

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-proactive-run-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    const now = Date.now();
    const automation: Automation = {
      id: automationId,
      name: 'Watch release',
      enabled: true,
      trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'Inspect release evidence.' },
      safety: { mode: 'suggest_only' },
      afterRun: { kind: 'none' },
      state: {},
      createdAtMs: now,
      updatedAtMs: now,
    };
    saveAutomation(automation);
    const thread = upsertWorkUnderstandingThread({
      canonicalKey: 'release',
      title: 'Release desktop app',
      summary: 'Prepare and validate release.',
      status: 'active',
      horizon: 'current',
      focusScore: 90,
      confidence: 0.9,
      projectIds: [],
      evidenceIds: [],
    });
    createFocusWatch({ threadId: thread.id, automationId, kind: 'progress' });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('accepts only complete evidence-backed results', () => {
    expect(parseFocusRunResult('{"meaningful":false}')).toEqual({ meaningful: false });
    expect(parseFocusRunResult('{"meaningful":true,"title":"Changed"}')).toBeNull();
    expect(parseFocusRunResult('```json\n{"meaningful":false}\n```')).toEqual({ meaningful: false });
    expect(hasValidIntelligenceEvidence([{
      label: 'Official release note',
      source: 'https://example.com/releases/1',
      publishedAt: '2026-08-02T00:00:00.000Z',
    }])).toBe(true);
    expect(hasValidIntelligenceEvidence([{ label: 'Rumor', source: 'chat message' }])).toBe(false);
  });

  it('creates one insight for a meaningful run and stays silent for empty runs', () => {
    const meaningful = completedRun('run-1', JSON.stringify({
      meaningful: true,
      title: 'Release checks passed',
      summary: 'The packaging checks now pass.',
      whyItMatters: 'The release is no longer blocked by packaging.',
      nextAction: 'Run the signed installer smoke test.',
      evidence: [{ label: 'Packaging suite: 24 passed', source: 'test output' }],
    }));
    saveAutomationRun(meaningful);

    expect(processFocusAutomationRun(meaningful).insight).toMatchObject({
      title: 'Release checks passed',
      status: 'unread',
    });
    expect(processFocusAutomationRun(meaningful)).toEqual({ handled: true });
    expect(listProactiveInsights()).toHaveLength(1);

    const duplicate = completedRun('run-duplicate', meaningful.summary!);
    saveAutomationRun(duplicate);
    expect(processFocusAutomationRun(duplicate)).toEqual({ handled: true });
    expect(listProactiveInsights()).toHaveLength(1);

    const empty = completedRun('run-2', '{"meaningful":false}');
    saveAutomationRun(empty);
    expect(processFocusAutomationRun(empty)).toEqual({ handled: true });
    expect(processFocusAutomationRun(empty)).toEqual({ handled: true });
    expect(listProactiveInsights()).toHaveLength(1);
    expect(getFocusWatchByAutomationId(automationId)?.consecutiveEmptyRuns).toBe(1);
  });

  function completedRun(id: string, summary: string): AutomationRun {
    const now = Date.now();
    return {
      id,
      automationId,
      automationName: 'Watch release',
      status: 'succeeded',
      triggerSnapshot: { kind: 'manual' },
      actionSnapshot: { kind: 'agent', instruction: 'Inspect release evidence.' },
      manual: false,
      createdAtMs: now - 10,
      startedAtMs: now - 5,
      endedAtMs: now,
      durationMs: 5,
      summary,
    };
  }
});
