import { describe, expect, it } from 'vitest';

import type { BrowserWorkflow } from '../browser-workflow-api';
import {
  browserWorkflowInputsComplete,
  defaultBrowserWorkflowInputs,
} from '../browser-workflow-input-utils';

const workflow: BrowserWorkflow = {
  id: 'order-lookup',
  name: 'Order lookup',
  enabled: true,
  risk: 'read_only',
  domains: ['example.com'],
  inputs: {
    orderId: { type: 'string', required: true, description: 'Order number' },
    includeHistory: { type: 'boolean', default: false },
  },
  createdAtMs: 1,
  updatedAtMs: 1,
};

describe('browser workflow input forms', () => {
  it('starts with declared defaults without inventing missing values', () => {
    expect(defaultBrowserWorkflowInputs(workflow)).toEqual({ includeHistory: false });
  });

  it('requires only the fields marked as required', () => {
    expect(browserWorkflowInputsComplete(workflow, { includeHistory: false })).toBe(false);
    expect(browserWorkflowInputsComplete(workflow, { orderId: 'A-123', includeHistory: false })).toBe(true);
  });
});
