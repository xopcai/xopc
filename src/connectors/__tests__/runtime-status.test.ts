import { describe, expect, it } from 'vitest';

import type { ConnectorConnection, ConnectorInstance } from '../types.js';
import { projectComposioRuntimeStatus } from '../runtime-status.js';

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

describe('projectComposioRuntimeStatus', () => {
  it('marks an active account with usable tools as ready', () => {
    const [projected] = projectComposioRuntimeStatus(
      [instance()],
      [connection('active')],
      [{ connectorId: 'composio-gmail', checkedAt: '2026-08-01T09:00:00.000Z', toolCount: 7 }],
    );
    expect(projected).toMatchObject({
      status: 'connected',
      connectionStatus: 'connected',
      authStatus: 'connected',
      usage: { lastHealthStatus: 'ok', lastToolCount: 7 },
    });
  });

  it('requires attention when tools cannot be loaded', () => {
    const [projected] = projectComposioRuntimeStatus(
      [instance()],
      [connection('active')],
      [{ connectorId: 'composio-gmail', checkedAt: '2026-08-01T09:00:00.000Z', toolCount: 0 }],
    );
    expect(projected).toMatchObject({
      status: 'degraded',
      connectionStatus: 'connected',
      usage: { lastHealthStatus: 'tools_list_failed', lastToolCount: 0 },
    });
  });

  it('requires setup when no account connection exists', () => {
    const [projected] = projectComposioRuntimeStatus([instance()], [], []);
    expect(projected).toMatchObject({
      status: 'not_configured',
      connectionStatus: 'disconnected',
      authStatus: 'missing',
    });
  });
});
