import { describe, expect, it } from 'vitest';

import type { ConnectionNeed } from '@xopcai/gateway-contract';

import { missingConnectionCapabilities } from '../connection-capabilities.js';

function genericNeed(): ConnectionNeed {
  return {
    key: 'composio-clickup:default',
    target: { type: 'connector', connectorId: 'composio-clickup' },
    label: 'ClickUp',
    capabilities: ['tools'],
  };
}

describe('connection capability checks', () => {
  it('accepts a generic catalog connector when it exposes any curated tool', () => {
    expect(missingConnectionCapabilities(genericNeed(), new Set(['CLICKUP_GET_TASKS']))).toEqual([]);
  });

  it('keeps a generic catalog connector waiting when it exposes no curated tools', () => {
    expect(missingConnectionCapabilities(genericNeed(), new Set())).toEqual(['tools']);
  });
});
