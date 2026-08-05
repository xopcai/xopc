import { describe, expect, it } from 'vitest';

import type { ConnectorConnection, ConnectorInstance } from '../types.js';
import { projectComposioConnectionStatus } from '../runtime-status.js';

function instance(): ConnectorInstance {
  return {
    instanceId: 'composio-gmail-local-owner',
    connectorId: 'composio-gmail',
    displayName: 'Gmail',
    enabled: true,
    status: 'installed',
    secretStatus: {},
    materialized: { type: 'composio', id: 'gmail', toolkit: 'gmail', role: 'toolkit' },
    usage: {},
    audit: [],
  };
}

function connection(status: ConnectorConnection['status']): ConnectorConnection {
  return {
    id: 'gmail-account',
    connectorId: 'composio-gmail',
    provider: 'composio',
    principalId: 'local-owner',
    providerConnectionId: 'provider-account',
    identity: {},
    status,
    isDefault: true,
    connectedAt: '2026-08-01T08:00:00.000Z',
    metadata: {},
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-08-01T08:00:00.000Z',
  };
}

describe('projectComposioConnectionStatus', () => {
  it('marks an active account as connected using local connection state', () => {
    const [projected] = projectComposioConnectionStatus([instance()], [connection('active')]);
    expect(projected).toMatchObject({
      status: 'connected',
      connectionStatus: 'connected',
      authStatus: 'connected',
      lastConnectedAt: '2026-08-01T08:00:00.000Z',
    });
  });

  it('projects pending accounts without probing external tools', () => {
    const [projected] = projectComposioConnectionStatus([instance()], [connection('pending')]);
    expect(projected).toMatchObject({
      status: 'connecting',
      connectionStatus: 'connecting',
      authStatus: 'unknown',
    });
  });

  it('requires setup when no account connection exists', () => {
    const [projected] = projectComposioConnectionStatus([instance()], []);
    expect(projected).toMatchObject({
      status: 'not_configured',
      connectionStatus: 'disconnected',
      authStatus: 'missing',
    });
  });
});
