import { describe, expect, it } from 'vitest';

import type { ComposioConnection } from '../connectors-api';
import { groupComposioConnections } from '../composio-connection-groups';

function connection(id: string, patch: Partial<ComposioConnection> = {}): ComposioConnection {
  return {
    id,
    providerConnectionId: `ca_${id}`,
    toolkit: 'slack',
    status: 'active',
    isDefault: false,
    isCurrentAuthorization: false,
    ...patch,
  };
}

describe('groupComposioConnections', () => {
  it('groups repeated OAuth authorizations for the same strong identity', () => {
    const groups = groupComposioConnections([
      connection('old', { identityKey: 'slack:-:T1:U1', connectedAt: '2026-08-19T00:00:00Z' }),
      connection('new', { identityKey: 'slack:-:T1:U1', connectedAt: '2026-08-20T00:00:00Z' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.primary.id).toBe('new');
    expect(groups[0]?.authorizations).toHaveLength(2);
  });

  it('does not guess when a stable identity is unavailable', () => {
    expect(groupComposioConnections([connection('one'), connection('two')])).toHaveLength(2);
  });

  it('prefers an active authorization over a newer expired authorization', () => {
    const groups = groupComposioConnections([
      connection('active', { identityKey: 'slack:-:T1:U1' }),
      connection('expired', {
        identityKey: 'slack:-:T1:U1', status: 'expired', connectedAt: '2026-08-20T00:00:00Z',
      }),
    ]);
    expect(groups[0]?.primary.id).toBe('active');
  });
});
