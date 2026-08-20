import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  getConnectorSyncPolicy,
  listConnectorAccounts,
  listConnectorConnections,
  openXopcDatabase,
  reconcileConnectorAccount,
  resetXopcDatabaseSingletonForTest,
  upsertConnectorConnection,
  upsertConnectorSyncPolicy,
} from '../index.js';

describe('connector account repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-connector-account-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('merges duplicate authorizations into one logical account and preserves its policy', () => {
    const connection = (id: string, connectedAt: string) => upsertConnectorConnection({
      id,
      connectorId: 'composio-slack',
      provider: 'composio',
      principalId: 'local-owner',
      providerConnectionId: `provider-${id}`,
      identity: { workspaceId: 'T123', userId: 'U123', workspace: 'Acme' },
      status: 'active',
      isDefault: id === 'slack-new',
      connectedAt,
      metadata: { toolkit: 'slack' },
    });
    const oldAuthorization = connection('slack-old', '2026-08-01T00:00:00.000Z');
    reconcileConnectorAccount({
      connectionId: oldAuthorization.id,
      identityKey: 'slack:-:T123:U123',
      identity: oldAuthorization.identity,
    });

    const newAuthorization = connection('slack-new', '2026-08-02T00:00:00.000Z');
    upsertConnectorSyncPolicy({
      accountId: newAuthorization.accountId!,
      scanEnabled: false,
      intervalMinutes: 60,
    });
    const account = reconcileConnectorAccount({
      connectionId: newAuthorization.id,
      identityKey: 'slack:-:T123:U123',
      identity: newAuthorization.identity,
    });

    expect(listConnectorAccounts({ connectorId: 'composio-slack' })).toEqual([account]);
    expect(account).toMatchObject({
      identityKey: 'slack:-:T123:U123',
      currentConnectionId: 'slack-new',
      identity: { workspaceId: 'T123', userId: 'U123', workspace: 'Acme' },
    });
    expect(listConnectorConnections({ connectorId: 'composio-slack' }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'slack-old', accountId: account.id }),
        expect.objectContaining({ id: 'slack-new', accountId: account.id }),
      ]));
    expect(getConnectorSyncPolicy(account.id)).toMatchObject({
      accountId: account.id,
      scanEnabled: false,
      intervalMinutes: 60,
    });
  });
});
