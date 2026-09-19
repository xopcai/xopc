import { describe, expect, it } from 'vitest';

import { connectorIdentityKey, connectorIdentitySummary, mergeConnectorIdentity, normalizeConnectorIdentity } from '../connector-identity.js';

describe('connector identity', () => {
  it('never exposes provider credentials or arbitrary metadata as account identity', () => {
    const raw = { email: 'owner@example.test', access_token: 'secret', refresh_token: 'secret', nested: { password: 'secret' } };
    expect(connectorIdentitySummary(raw)).toEqual({ email: raw.email });
    expect(mergeConnectorIdentity('gmail', {}, raw)).toEqual({ email: raw.email });
  });
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

  it('normalizes Google Drive ownership identity from the about response', () => {
    const identity = normalizeConnectorIdentity('googledrive', {
      data: { user: { emailAddress: 'owner@example.com', displayName: 'Owner' } },
    });
    expect(identity).toEqual({ email: 'owner@example.com', displayName: 'Owner' });
    expect(connectorIdentityKey('googledrive', identity)).toBe('googledrive:owner@example.com');
  });

  it('preserves probed identity when Composio later returns sparse connection data', () => {
    expect(mergeConnectorIdentity(
      'slack',
      { workspaceId: 'T123', userId: 'U123', workspace: 'Acme' },
      { team_id: 'T123' },
    )).toMatchObject({ workspaceId: 'T123', userId: 'U123', workspace: 'Acme' });
  });
});
