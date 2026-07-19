import { describe, expect, it } from 'vitest';

import { buildInput } from '../automations-page';
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
      actionMode: 'agent',
      agentId: '',
      instruction: 'Prepare a recommendation.',
      workflowId: '',
      workflowGoal: '',
      workflowInput: { goal: '', argValues: {}, schemaInput: {}, concurrency: '', maxSubagents: '' },
      workflowInputValid: true,
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
      actionMode: 'agent',
      agentId: '',
      instruction: 'Prepare a recommendation.',
      workflowId: '',
      workflowGoal: '',
      workflowInput: { goal: '', argValues: {}, schemaInput: {}, concurrency: '', maxSubagents: '' },
      workflowInputValid: true,
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
