import { describe, expect, it } from 'vitest';

import { connectorIdentityKey, mergeConnectorIdentity, normalizeConnectorIdentity } from '../connector-identity.js';

describe('connector identity', () => {
  it('normalizes Slack auth.test output and creates a stable strong key', () => {
    const identity = normalizeConnectorIdentity('slack', {
      data: { team_id: 'T123', team: 'Acme', user_id: 'U123', user: 'Mic' },
    });
    expect(identity).toMatchObject({ workspaceId: 'T123', workspace: 'Acme', userId: 'U123', username: 'Mic' });
    expect(connectorIdentityKey('slack', identity)).toBe('slack:-:T123:U123');
  });

  it('does not merge Slack connections without both workspace and subject identifiers', () => {
    expect(connectorIdentityKey('slack', { workspaceId: 'T123' })).toBeUndefined();
  });

  it('preserves probed identity when Composio later returns sparse connection data', () => {
    expect(mergeConnectorIdentity(
      'slack',
      { workspaceId: 'T123', userId: 'U123', workspace: 'Acme' },
      { team_id: 'T123' },
    )).toMatchObject({ workspaceId: 'T123', userId: 'U123', workspace: 'Acme' });
  });
});
