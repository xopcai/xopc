import { describe, expect, it } from 'vitest';

import type { WorkflowDefinition } from '../workflow-api';
import {
  resolveWorkflowInputPayload,
  validateWorkflowInputEditorValue,
  type WorkflowInputEditorValue,
} from '../workflow-input-editor.utils';

const schemaWorkflow: WorkflowDefinition = {
  id: 'schema-workflow',
  name: 'schemaWorkflow',
  title: 'Schema workflow',
  description: 'Uses JSON schema input.',
  version: '1.0.0',
  revision: 1,
  graph: { schemaVersion: 1, nodes: [], edges: [] },
  inputSchema: {
    type: 'object',
    required: ['topic'],
    properties: {
      topic: { type: 'string', title: 'Topic' },
      includeLinks: { type: 'boolean', title: 'Include links' },
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

const emptyValue: WorkflowInputEditorValue = {
  goal: '',
  argValues: {},
  schemaInput: {},
};

describe('workflow input editor helpers', () => {
  it('requires schema required fields', () => {
    expect(validateWorkflowInputEditorValue(schemaWorkflow, emptyValue).valid).toBe(false);
    expect(validateWorkflowInputEditorValue(schemaWorkflow, {
      ...emptyValue,
      schemaInput: { topic: 'launch notes' },
    }).valid).toBe(true);
  });

  it('treats invalid raw JSON state as invalid even when prior payload exists', () => {
    expect(validateWorkflowInputEditorValue(schemaWorkflow, {
      ...emptyValue,
      schemaInput: { topic: 'launch notes' },
    }, false)).toEqual({ valid: false, reason: 'raw-json' });
  });

  it('resolves schema input payload', () => {
    expect(resolveWorkflowInputPayload(schemaWorkflow, {
      ...emptyValue,
      schemaInput: { topic: 'launch notes', includeLinks: true },
    })).toEqual({ topic: 'launch notes', includeLinks: true });
  });
});
