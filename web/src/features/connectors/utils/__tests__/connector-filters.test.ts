import { describe, expect, it } from 'vitest';

import type { ConnectorDefinition } from '../../connectors-api';
import { isProductConnector } from '../connector-filters';

function connector(overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  return {
    id: 'example',
    version: '1.0.0',
    displayName: 'Example',
    description: 'Example',
    category: 'custom',
    kind: 'composio',
    source: 'builtin',
    capabilities: ['tools'],
    auth: { mode: 'oauth', provider: 'composio' },
    setup: {},
    runtime: { type: 'composio', toolkit: 'gmail', role: 'toolkit' },
    ...overrides,
  };
}

describe('isProductConnector', () => {
  it('keeps application connectors visible', () => {
    expect(isProductConnector(connector())).toBe(true);
  });

  it('hides provider credentials from the user-facing catalog', () => {
    expect(isProductConnector(connector({
      id: 'composio-api-key',
      runtime: { type: 'composio', toolkit: 'composio', role: 'credential' },
    }))).toBe(false);
  });
});
