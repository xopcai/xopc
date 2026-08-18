import { describe, expect, it } from 'vitest';

import { messages } from '@/i18n/messages';

import type { Automation, AutomationRun, AutomationRunEvent } from '../automation-api';
import { buildRunExplanation, matchesCoverage } from '../automation-explanations';

function eventAutomation(
  payloadMatch?: Record<string, string | number | boolean | null>,
  source = 'outcomes',
): Automation {
  return {
    id: 'automation-1',
    name: 'Blocked goal helper',
    enabled: true,
    trigger: {
      kind: 'event',
      eventType: 'outcome.status_changed',
      source,
      ...(payloadMatch ? { payloadMatch } : {}),
    },
    action: { kind: 'agent', instruction: 'Diagnose blocker' },
    state: {},
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

describe('automation explanations', () => {
  it('treats broad event automations as covering a specific product event', () => {
    expect(matchesCoverage(eventAutomation(), {
      eventType: 'outcome.status_changed',
      source: 'outcomes',
      eventPayload: { outcomeId: 'goal-1', status: 'blocked' },
    })).toBe(true);
  });

  it('does not treat object-specific payload filters as covering another object', () => {
    expect(matchesCoverage(eventAutomation({ outcomeId: 'goal-2', status: 'blocked' }), {
      eventType: 'outcome.status_changed',
      source: 'outcomes',
      eventPayload: { outcomeId: 'goal-1', status: 'blocked' },
    })).toBe(false);
  });

  it('explains why an event-triggered run was queued', () => {
    const labels = messages('en').automations;
    const run: AutomationRun = {
      id: 'run-1',
      automationId: 'automation-1',
      automationName: 'Blocked goal helper',
      status: 'queued',
      triggerSnapshot: {
        kind: 'event',
        eventType: 'outcome.status_changed',
        source: 'outcomes',
        payloadMatch: { status: 'blocked' },
      },
      actionSnapshot: { kind: 'agent', instruction: 'Diagnose blocker' },
      manual: false,
      createdAtMs: 1,
    };
    const triggerEvent: AutomationRunEvent = {
      id: 'event-1',
      runId: 'run-1',
      automationId: 'automation-1',
      type: 'run.queued',
      message: 'Event outcome.status_changed queued automation',
      data: {
        event: {
          type: 'outcome.status_changed',
          source: 'outcomes',
          payload: { outcomeId: 'goal-1', status: 'blocked' },
        },
      },
      createdAtMs: 1,
    };

    expect(buildRunExplanation(run, triggerEvent, labels)).toEqual([
      'Event outcome.status_changed from outcomes',
      'Matched status=blocked',
      'Safety: Auto apply',
      'Runs agent action',
    ]);
  });
});
