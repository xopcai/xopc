import { describe, expect, it } from 'vitest';

import type { Automation, AutomationRun } from '../automation-api';
import { automationHasExecutionIssue, latestAutomationRun } from '../automation-result-state';

const automation = { id: 'a', state: {} } as Automation;
const run = (status: AutomationRun['status'], createdAtMs: number, automationId = 'a') => (
  { id: `${automationId}-${createdAtMs}`, automationId, status, createdAtMs } as AutomationRun
);

describe('automation result state', () => {
  it('uses chronological order rather than the operations list priority', () => {
    const runs = [run('failed', 10), run('succeeded', 20), run('failed', 30, 'other')];
    expect(latestAutomationRun('a', runs)?.status).toBe('succeeded');
    expect(automationHasExecutionIssue(automation, runs)).toBe(false);
  });

  it('uses task state when recent global results omit the task', () => {
    expect(automationHasExecutionIssue({ ...automation, state: { lastRunStatus: 'timeout' } }, [])).toBe(true);
  });

  it('does not treat cancellation as an execution failure', () => {
    expect(automationHasExecutionIssue(automation, [run('cancelled', 20)])).toBe(false);
  });

  it('prefers newer task state over stale results', () => {
    expect(automationHasExecutionIssue({ ...automation, state: { lastRunStatus: 'succeeded', lastRunAtMs: 30 } }, [run('failed', 10)])).toBe(false);
    expect(automationHasExecutionIssue({ ...automation, state: { lastRunStatus: 'failed', lastRunAtMs: 30 } }, [run('succeeded', 10)])).toBe(true);
  });
});
