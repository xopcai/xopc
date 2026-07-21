import { describe, expect, it } from 'vitest';

import { parseLocalAppAcceptanceConfig } from '../acceptance.js';

describe('local app acceptance config', () => {
  it('accepts bounded declarative actions and assertions', () => {
    expect(parseLocalAppAcceptanceConfig({
      schemaVersion: 1,
      scenarios: [{
        id: 'create-item',
        name: 'Create an item',
        steps: [
          { action: 'fill', target: 'item-name', value: 'Read later' },
          { action: 'click', target: 'add-item' },
          { assert: 'text_visible', text: 'Read later' },
          { assert: 'value_equals', target: 'item-name', value: '' },
        ],
      }],
    }).scenarios).toHaveLength(1);
  });

  it('rejects selectors and executable steps', () => {
    expect(() => parseLocalAppAcceptanceConfig({
      schemaVersion: 1,
      scenarios: [{ id: 'unsafe', name: 'Unsafe', steps: [{ action: 'click', target: '#save button' }] }],
    })).toThrow('letters, numbers');
    expect(() => parseLocalAppAcceptanceConfig({
      schemaVersion: 1,
      scenarios: [{ id: 'unsafe', name: 'Unsafe', steps: [{ action: 'evaluate', value: 'alert(1)' }] }],
    })).toThrow('unsupported action');
    expect(() => parseLocalAppAcceptanceConfig({
      schemaVersion: 1,
      scenarios: [{ id: 'unsafe', name: 'Unsafe', steps: [{ action: 'click', target: 'save', script: 'alert(1)' }] }],
    })).toThrow('unsupported action');
  });
});
