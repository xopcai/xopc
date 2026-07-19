import { describe, expect, it } from 'vitest';

import type { ConnectorDefinition } from '../../connectors-api';
import { connectorBenefitFor, connectorFirstValue, groupConnectorsByBenefit } from '../connector-benefits';

function connector(overrides: Partial<ConnectorDefinition>): ConnectorDefinition {
  return {
    id: 'example',
    version: '1.0.0',
    displayName: 'Example',
    description: 'Example connector',
    category: 'custom',
    kind: 'mcp',
    source: 'builtin',
    capabilities: ['tools'],
    tags: [],
    auth: { mode: 'none' },
    setup: {},
    runtime: { type: 'mcp', serverId: 'example' },
    ...overrides,
  };
}

describe('connectorBenefitFor', () => {
  it('prioritizes communication connectors', () => {
    expect(connectorBenefitFor(connector({ displayName: 'Slack', capabilities: ['tools', 'events'] }))).toBe('reach');
  });

  it('recognizes context and knowledge sources', () => {
    expect(connectorBenefitFor(connector({ category: 'docs', capabilities: ['resources'] }))).toBe('understand');
    expect(connectorBenefitFor(connector({ displayName: 'Notion', capabilities: ['tools'] }))).toBe('understand');
  });

  it('defaults action tools to getting work done', () => {
    expect(connectorBenefitFor(connector({ category: 'code', capabilities: ['tools'] }))).toBe('act');
  });

  it('groups connectors without dropping any', () => {
    const groups = groupConnectorsByBenefit([
      connector({ id: 'docs', category: 'docs' }),
      connector({ id: 'browser', category: 'browser' }),
      connector({ id: 'mail', capabilities: ['channel'] }),
    ]);
    expect(groups.understand).toHaveLength(1);
    expect(groups.act).toHaveLength(1);
    expect(groups.reach).toHaveLength(1);
  });

  it('shows the first concrete value only after a healthy connection', () => {
    const definition = connector({ category: 'docs', capabilities: ['resources'] });
    const instance = {
      instanceId: 'instance-1', connectorId: definition.id, displayName: 'Docs', enabled: true,
      status: 'connected' as const, connectionStatus: 'connected' as const, secretStatus: {},
      materialized: { type: 'mcp' as const, serverId: 'docs' },
      usage: { lastHealthStatus: 'ok' as const, lastResourceCount: 12 }, audit: [],
    };
    expect(connectorFirstValue(instance, definition)).toEqual({
      benefit: 'understand', state: 'ready', availableCount: 12,
    });
    expect(connectorFirstValue({ ...instance, status: 'not_configured', connectionStatus: 'disconnected', usage: {} }, definition).state).toBe('needs_setup');
  });
});
