import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getConnectorInstallation, upsertConnectorConnection, upsertConnectorInstallation } from '../../storage/sqlite/connector-repository.js';
import { getConnectorAccount, reconcileConnectorAccount, updateConnectorAccount } from '../../storage/sqlite/connector-account-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { canAccessConnectorAccount, currentAccountConnections } from '../account-access.js';
import { activateComposioBackend, addComposioBackend, getComposioBackend } from '../composio-backends.js';

describe('stable connector account policy', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });
  const connection = (id: string) => upsertConnectorConnection({ id, connectorId: 'composio-gmail', provider: 'composio',
    principalId: 'local-owner', providerConnectionId: id, identity: { email: 'owner@example.test' }, status: 'active', isDefault: false, metadata: {} });
  const policy = () => upsertConnectorInstallation({ id: 'gmail', connectorId: 'composio-gmail', principalId: 'local-owner',
    enabled: true, maxScope: 'read', confirmationPolicy: 'writes', allowedAgentIds: [], selectedAccountIds: null });

  it('distinguishes inherit, deny all, pause and explicit agent restrictions', () => {
    const account = connection('first'); const installation = policy();
    expect(canAccessConnectorAccount(account, installation, 'main')).toBe(true);
    expect(canAccessConnectorAccount(account, { ...installation, selectedAccountIds: [] }, 'main')).toBe(false);
    updateConnectorAccount(account.accountId!, { allowedAgentIds: [] });
    expect(canAccessConnectorAccount(account, installation, 'main')).toBe(false);
    updateConnectorAccount(account.accountId!, { allowedAgentIds: ['work'] });
    expect(canAccessConnectorAccount(account, installation, 'main')).toBe(false);
    expect(canAccessConnectorAccount(account, installation, 'work')).toBe(true);
    updateConnectorAccount(account.accountId!, { enabled: false });
    expect(canAccessConnectorAccount(account, installation, 'work')).toBe(false);
  });

  it('reauthorizes the same identity without losing account restrictions or allowlists', () => {
    const first = connection('first'); const installation = policy();
    reconcileConnectorAccount({ connectionId: first.id, identityKey: 'email:owner', identity: first.identity });
    updateConnectorAccount(first.accountId!, { label: 'Work', allowedAgentIds: ['work'], enabled: false });
    const second = connection('second');
    upsertConnectorInstallation({ ...installation, selectedAccountIds: [second.accountId!] });
    const merged = reconcileConnectorAccount({ connectionId: second.id, identityKey: 'email:owner', identity: second.identity });
    expect(merged).toMatchObject({ id: first.accountId, label: 'Work', enabled: false, allowedAgentIds: ['work'] });
    expect(getConnectorInstallation('gmail')?.selectedAccountIds).toEqual([first.accountId]);
    expect(getConnectorAccount(second.accountId!)).toBeUndefined();
  });

  it('does not merge identities across connection services or rebind existing accounts on switch', () => {
    const a = addComposioBackend({ mode: 'managed', label: 'Cloud' });
    const b = addComposioBackend({ mode: 'byok', label: 'Project', credentialRef: 'test' });
    const first = connection('first'); const second = connection('second');
    const db = getSqliteDatabase();
    db.prepare('UPDATE connector_accounts SET backend_id = ? WHERE id = ?').run(a.id, first.accountId!);
    db.prepare('UPDATE connector_accounts SET backend_id = ? WHERE id = ?').run(b.id, second.accountId!);
    for (const item of [first, second]) reconcileConnectorAccount({ connectionId: item.id, identityKey: 'email:owner', identity: item.identity });
    activateComposioBackend(a.id); activateComposioBackend(b.id);
    expect(getComposioBackend()?.id).toBe(b.id);
    expect(getConnectorAccount(first.accountId!)?.backendId).toBe(a.id);
    expect(getConnectorAccount(second.accountId!)?.backendId).toBe(b.id);
    expect(currentAccountConnections([first, second])).toHaveLength(2);
  });

  it('does not resurrect a deleted account when a stale sync completes after identity reconciliation', () => {
    const first = connection('first');
    reconcileConnectorAccount({ connectionId: first.id, identityKey: 'email:owner', identity: first.identity, backendId: 'backend' });
    updateConnectorAccount(first.accountId!, { allowedAgentIds: ['work'], enabled: false });
    const stale = connection('second');
    reconcileConnectorAccount({ connectionId: stale.id, identityKey: 'email:owner', identity: stale.identity, backendId: 'backend' });
    const updated = upsertConnectorConnection({ ...stale, metadata: { backendId: 'backend' } });
    expect(updated.accountId).toBe(first.accountId);
    expect(getConnectorAccount(stale.accountId!)).toBeUndefined();
    expect(getConnectorAccount(updated.accountId!)).toMatchObject({ backendId: 'backend', enabled: false, allowedAgentIds: ['work'] });
  });
});
