import type { Automation, AutomationRun } from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import {
  automationActionPreview,
  formatAutomationDuration,
  isAutomationRunActive,
  isAutomationRunProblem,
} from '../automation-presentation';

const automation = {
  id: 'a', name: 'A', enabled: true, trigger: { kind: 'manual' },
  action: { kind: 'workflow', workflowId: 'ship', goal: 'Ship release' },
  state: {}, createdAtMs: 1, updatedAtMs: 1,
} as Automation;

function run(status: AutomationRun['status']): AutomationRun {
  return {
    id: status,
    automationId: 'a',
    automationName: 'A',
    status,
    triggerSnapshot: automation.trigger,
    actionSnapshot: automation.action,
    manual: false,
    createdAtMs: 1,
  };
}

describe('automation presentation', () => {
  it('keeps active and attention states distinct', () => {
    expect(['queued', 'running', 'cancelling'].map((status) => isAutomationRunActive(run(status as AutomationRun['status'])))).toEqual([true, true, true]);
    expect(isAutomationRunProblem(run('timeout'))).toBe(true);
    expect(isAutomationRunProblem(run('cancelled'))).toBe(false);
  });

  it('formats useful compact values', () => {
    expect(formatAutomationDuration(65_000)).toBe('1m 5s');
    expect(automationActionPreview(automation)).toBe('Ship release');
  });
});
