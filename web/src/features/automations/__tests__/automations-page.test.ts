import { describe, expect, it } from 'vitest';

import { buildInput } from '../automations-page';
import type { WorkflowDefinition } from '@/features/workflows/workflow-api';

const workflow: WorkflowDefinition = {
  id: 'wf-report',
  name: 'report',
  title: 'Report',
  description: 'Prepare a report.',
  version: '1.0.0',
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
      intervalMinutes: '60',
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
  });
});
