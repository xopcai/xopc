import { describe, expect, it } from 'vitest';

import {
  buildAutomationEditInput,
  buildInput,
  formFromAutomation,
  initialForm,
} from '../automation-form';
import type { Automation, AutomationInput } from '../automation-api';
import type { WorkflowDefinition } from '@/features/workflows/workflow-api';

const workflow: WorkflowDefinition = {
  id: 'wf-report',
  name: 'report',
  title: 'Report',
  description: 'Prepare a report.',
  version: '1.0.0',
  revision: 1,
  graph: { schemaVersion: 1, nodes: [], edges: [] },
  inputSchema: {
    type: 'object',
    required: ['topic'],
    properties: {
      topic: { type: 'string', title: 'Topic' },
    },
  },
  phases: [],
  defaults: { concurrency: 1, timeoutSec: 300, maxSubagents: 2 },
  metadata: {
    tags: [],
    builtIn: false,
    source: 'user',
    createdAtMs: 1,
    updatedAtMs: 1,
  },
};

describe('automation buildInput', () => {
  it('round-trips an AI-generated weekly schedule through the editable form', () => {
    const automation: AutomationInput = {
      name: 'Weekly report',
      description: 'Summarize this week.',
      trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 17 * * 5' } },
      action: { kind: 'agent', instruction: 'Write my weekly report.', timeoutSeconds: 300 },
      safety: { mode: 'suggest_only' },
      afterRun: { kind: 'none' },
      reliability: { timeoutSeconds: 300, disableAfterConsecutiveFailures: 3 },
    };

    const form = formFromAutomation(automation);

    expect(form).toMatchObject({ triggerMode: 'weekly', time: '17:00', weekday: '5' });
    expect(buildInput(form, null).trigger).toEqual(automation.trigger);
  });

  it('preserves hidden advanced fields when editing an existing automation', () => {
    const automation: Automation = {
      id: 'automation-1',
      name: 'Custom event review',
      description: 'Review selected Telegram messages.',
      enabled: true,
      trigger: {
        kind: 'event',
        eventType: 'channel.message.received',
        source: 'channels',
        payloadMatch: { channel: 'telegram' },
      },
      action: {
        kind: 'agent',
        agentId: 'main',
        instruction: 'Review the message.',
        workingDirectory: '/workspace/project',
        model: 'openai/gpt-5',
        timeoutSeconds: 600,
      },
      safety: { mode: 'ask_before_apply' },
      afterRun: { kind: 'saveToSession' },
      reliability: {
        timeoutSeconds: 600,
        retryCount: 2,
        maxConcurrentRuns: 4,
        disableAfterConsecutiveFailures: 5,
      },
      state: {},
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const form = formFromAutomation(automation);
    const edited = buildAutomationEditInput(automation, {
      ...form,
      name: 'Telegram review',
      description: '',
      agentId: '',
    }, null);

    expect(form).toMatchObject({
      triggerMode: 'event',
      eventType: 'channel.message.received',
      eventSource: 'channels',
    });
    expect(edited.trigger).toEqual(automation.trigger);
    expect(edited.action).toMatchObject({
      kind: 'agent',
      workingDirectory: '/workspace/project',
      model: 'openai/gpt-5',
    });
    expect(edited.description).toBe('');
    expect(edited.action.kind === 'agent' ? edited.action.agentId : undefined).toBeUndefined();
    expect(edited.reliability).toMatchObject({ retryCount: 2, maxConcurrentRuns: 4 });
  });

  it('includes structured workflow input when creating a workflow automation', () => {
    const input = buildInput({
      name: 'Morning report',
      description: '',
      triggerMode: 'daily',
      time: '09:30',
      weekday: '1',
      intervalValue: '1',
      intervalUnit: 'hour',
      cronExpr: '30 9 * * *',
      webhookSecretId: '',
      onceAt: '',
      eventType: '',
      eventSource: '',
      eventPayloadMatch: '',
      actionMode: 'workflow',
      agentId: 'main',
      instruction: '',
      workflowId: 'wf-report',
      workflowGoal: '',
      workflowInput: {
        goal: 'Summarize overnight changes.',
        argValues: {},
        schemaInput: { topic: 'overnight changes' },
        concurrency: '3',
        maxSubagents: '5',
      },
      workflowInputValid: true,
      browserWorkflowId: '',
      browserWorkflowInputs: {},
      safetyMode: 'suggest_only',
      timeoutSeconds: '300',
      afterRunMode: 'none',
      webhookUrl: '',
      disableAfterFailures: '3',
    }, workflow);

    expect(input.action).toMatchObject({
      kind: 'workflow',
      workflowId: 'wf-report',
      agentId: 'main',
      goal: 'Summarize overnight changes.',
      input: { topic: 'overnight changes' },
      concurrency: 3,
      maxSubagents: 5,
    });
    expect(input.safety).toEqual({ mode: 'suggest_only' });
  });

  it('builds a browser workflow automation with typed form inputs', () => {
    const input = buildInput({
      ...initialForm,
      name: 'Collect title',
      triggerMode: 'manual',
      actionMode: 'browser_recipe',
      browserWorkflowId: 'collect-title',
      browserWorkflowInputs: { query: 'xopc', limit: 2 },
      safetyMode: 'auto_apply',
    }, null);

    expect(input.action).toEqual({
      kind: 'browser_recipe',
      recipeId: 'collect-title',
      args: { query: 'xopc', limit: 2 },
      timeoutSeconds: 300,
    });
  });

  it('suppresses after-run webhooks outside auto-apply mode', () => {
    const input = buildInput({
      name: 'Safe report',
      description: '',
      triggerMode: 'manual',
      time: '09:30',
      weekday: '1',
      intervalValue: '1',
      intervalUnit: 'hour',
      cronExpr: '30 9 * * *',
      webhookSecretId: '',
      onceAt: '',
      eventType: '',
      eventSource: '',
      eventPayloadMatch: '',
      actionMode: 'agent',
      agentId: '',
      instruction: 'Prepare a recommendation.',
      workflowId: '',
      workflowGoal: '',
      workflowInput: { goal: '', argValues: {}, schemaInput: {}, concurrency: '', maxSubagents: '' },
      workflowInputValid: true,
      browserWorkflowId: '',
      browserWorkflowInputs: {},
      safetyMode: 'ask_before_apply',
      timeoutSeconds: '300',
      afterRunMode: 'webhook',
      webhookUrl: 'https://example.com/hook',
      disableAfterFailures: '3',
    }, null);

    expect(input.safety).toEqual({ mode: 'ask_before_apply' });
    expect(input.afterRun).toEqual({ kind: 'none' });
  });

  it('converts the selected interval unit without asking for minutes', () => {
    const input = buildInput({
      name: 'Interval report',
      description: '',
      triggerMode: 'interval',
      time: '09:30',
      weekday: '1',
      intervalValue: '1.5',
      intervalUnit: 'hour',
      cronExpr: '30 9 * * *',
      webhookSecretId: '',
      onceAt: '',
      eventType: '',
      eventSource: '',
      eventPayloadMatch: '',
      actionMode: 'agent',
      agentId: '',
      instruction: 'Prepare a recommendation.',
      workflowId: '',
      workflowGoal: '',
      workflowInput: { goal: '', argValues: {}, schemaInput: {}, concurrency: '', maxSubagents: '' },
      workflowInputValid: true,
      browserWorkflowId: '',
      browserWorkflowInputs: {},
      safetyMode: 'suggest_only',
      timeoutSeconds: '300',
      afterRunMode: 'none',
      webhookUrl: '',
      disableAfterFailures: '3',
    }, null);

    expect(input.trigger).toEqual({
      kind: 'schedule',
      schedule: { kind: 'interval', everyMs: 90 * 60_000 },
    });
  });
});
