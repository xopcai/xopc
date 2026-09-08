import { describe, expect, it } from 'vitest';

import type { BrowserNode } from '@xopcai/browser-control-contract';

import { classifyBrowserRisk } from '../policy/browser-policy.js';

const node = (states: string[]): BrowserNode => ({
  ref: 'e1',
  role: 'textbox',
  name: 'Field',
  states,
});

describe('browser action risk policy', () => {
  it('requires consequential approval for submit actions', () => {
    expect(classifyBrowserRisk({ action: 'fill', revision: 1, ref: 'e1', value: 'hello', submit: true }, node([])))
      .toBe('external_effect');
    expect(classifyBrowserRisk({ action: 'click', revision: 1, ref: 'e1' }, node(['submit'])))
      .toBe('external_effect');
    expect(classifyBrowserRisk({ action: 'press', revision: 1, key: 'Enter' }, node(['submit'])))
      .toBe('external_effect');
  });

  it('requires sensitive approval for protected fields', () => {
    expect(classifyBrowserRisk({ action: 'fill', revision: 1, ref: 'e1', value: '123' }, node(['sensitive'])))
      .toBe('sensitive');
  });
});
