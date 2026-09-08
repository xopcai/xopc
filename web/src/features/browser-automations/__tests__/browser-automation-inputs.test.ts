import { describe, expect, it } from 'vitest';

import type { BrowserAutomation } from '../browser-automation-api';
import {
  browserAutomationInputsComplete,
  defaultBrowserAutomationInputs,
} from '../browser-automation-input-utils';

const automation: BrowserAutomation = {
  id: 'order-lookup',
  name: 'Order lookup',
  enabled: true,
  risk: 'read',
  domains: ['example.com'],
  inputs: {
    orderId: { type: 'string', required: true, description: 'Order number' },
    includeHistory: { type: 'boolean', default: false },
  },
  createdAtMs: 1,
  updatedAtMs: 1,
};

describe('browser automation input forms', () => {
  it('starts with declared defaults without inventing missing values', () => {
    expect(defaultBrowserAutomationInputs(automation)).toEqual({ includeHistory: false });
  });

  it('requires only the fields marked as required', () => {
    expect(browserAutomationInputsComplete(automation, { includeHistory: false })).toBe(false);
    expect(browserAutomationInputsComplete(automation, { orderId: 'A-123', includeHistory: false })).toBe(true);
  });
});
