import { describe, expect, it } from 'vitest';

import {
  parseGeneratedAutomationDraft,
  parseGeneratedAutomationRepairDraft,
  simulateAutomation,
} from '../automation-draft-validator.js';

describe('automation draft validator', () => {
  it('parses generated automation JSON and simulates safety notes', () => {
    const draft = parseGeneratedAutomationDraft(JSON.stringify({
      automation: {
        name: 'Blocked goal helper',
        trigger: {
          kind: 'event',
          eventType: 'task.attention_required.v2',
          source: 'tasks',
          payloadMatch: { reason: 'blocked' },
        },
        action: {
          kind: 'agent',
          instruction: 'Analyze why the goal is blocked and suggest next steps.',
          timeoutSeconds: 300,
        },
        afterRun: { kind: 'none' },
        reliability: { timeoutSeconds: 300, disableAfterConsecutiveFailures: 3 },
      },
      explanation: 'Runs when a goal becomes blocked.',
      assumptions: ['Goal events include status.'],
      risks: [],
    }));

    expect(draft.automation.trigger).toMatchObject({
      kind: 'event',
      eventType: 'task.attention_required.v2',
    });

    const simulation = simulateAutomation(draft.automation);
    expect(simulation).toMatchObject({
      canRunNow: false,
      triggerSummary: 'Runs on product event task.attention_required.v2 from tasks.',
      actionSummary: 'Runs the default agent.',
    });
    expect(simulation.safetyNotes).toContain('Product-event trigger runs automatically when matching xopc events are published.');
  });

  it('flags external or destructive instructions for confirmation', () => {
    const simulation = simulateAutomation({
      name: 'Send update',
      trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'Send the final report to the customer.' },
    });

    expect(simulation.canRunNow).toBe(true);
    expect(simulation.requiredConfirmations).toContain('Agent instruction may perform an external or destructive action.');
  });

  it('parses repair patches and forces approval for risky changes', () => {
    const repair = parseGeneratedAutomationRepairDraft(JSON.stringify({
      patch: {
        action: {
          kind: 'agent',
          instruction: 'Send a short update after diagnosing the issue.',
          timeoutSeconds: 600,
        },
      },
      explanation: 'The previous instruction was too vague.',
      expectedEffect: 'The agent will produce and send a clearer update.',
      risks: ['This may contact an external person.'],
      requiresApproval: false,
    }), 0);

    expect(repair.patch.action).toMatchObject({ kind: 'agent', timeoutSeconds: 600 });
    expect(repair.requiresApproval).toBe(true);
  });
});
