import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, afterEach, describe, it, expect } from 'vitest';

import { openXopcDatabase, upsertConnectorInstallation, closeXopcDatabase, getConnectorAccount, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { cliAuthorizationView, commitCliIdentity, createCliAuthorization, readCliAuthorization, updateCliAuthorization } from '../store.js';

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'cli-store-')); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'test.db') }); upsertConnectorInstallation({ id: 'fixture-cli-local-owner', connectorId: 'fixture-cli', principalId: 'local-owner', enabled: true, allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedAccountIds: null }); });
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true }); });
const identity = { key: 'app:user', label: 'Test', scopes: ['read'], identity: { appId: 'app', openId: 'user' } };

describe('CLI authorization persistence', () => {
  it('publishes each authorization step and clears the previous link between steps', () => {
    const attempt = createCliAuthorization('fixture-cli', 'fixture-cli');
    updateCliAuthorization(attempt.id, { phase: 'awaiting_user', challenge: { type: 'open_url', url: 'https://open.feishu.cn/setup', step: 1, totalSteps: 2 } });
    expect(cliAuthorizationView(readCliAuthorization(attempt.id)!).challenge).toMatchObject({ step: 1, totalSteps: 2 });
    updateCliAuthorization(attempt.id, { phase: 'preparing' });
    expect(cliAuthorizationView(readCliAuthorization(attempt.id)!).challenge).toBeUndefined();
    updateCliAuthorization(attempt.id, { phase: 'awaiting_user', challenge: { type: 'open_url', url: 'https://open.feishu.cn/login', step: 2, totalSteps: 2 } });
    expect(cliAuthorizationView(readCliAuthorization(attempt.id)!).challenge).toMatchObject({ step: 2, url: 'https://open.feishu.cn/login' });
  });
  it('commits one verified identity and retains account ID on reauthorization', () => {
    const first = createCliAuthorization('fixture-cli', 'fixture-cli');
    expect(() => createCliAuthorization('fixture-cli', 'fixture-cli')).toThrow('already');
    updateCliAuthorization(first.id, { phase: 'verifying' });
    const accountId = commitCliIdentity(first, identity);
    const oldConnection = getConnectorAccount(accountId)!.currentConnectionId;
    const next = createCliAuthorization('fixture-cli', 'fixture-cli', accountId);
    updateCliAuthorization(next.id, { phase: 'verifying' });
    expect(commitCliIdentity(next, identity)).toBe(accountId);
    expect(getConnectorAccount(accountId)!.currentConnectionId).not.toBe(oldConnection);
    expect(getConnectorAccount(accountId)!.backendId).toBeUndefined();
  });
  it('does not replace a selected account with another user', () => {
    const first = createCliAuthorization('fixture-cli', 'fixture-cli'); updateCliAuthorization(first.id, { phase: 'verifying' });
    const accountId = commitCliIdentity(first, identity);
    const next = createCliAuthorization('fixture-cli', 'fixture-cli', accountId); updateCliAuthorization(next.id, { phase: 'verifying' });
    expect(() => commitCliIdentity(next, { ...identity, key: 'app:other' })).toThrow('does not match');
    expect(getConnectorAccount(accountId)!.identityKey).toBe('app:user');
  });
  it('rejects cancelled, expired and previous-process results', () => {
    const first = createCliAuthorization('one', 'fixture-cli'); updateCliAuthorization(first.id, { phase: 'cancelled' });
    expect(updateCliAuthorization(first.id, { phase: 'verifying' })).toBe(false);
    expect(() => commitCliIdentity(first, identity)).toThrow();
    const expired = createCliAuthorization('two', 'fixture-cli');
    getSqliteDatabase().prepare('UPDATE connector_cli_authorizations SET expires_at=0 WHERE id=?').run(expired.id);
    expect(readCliAuthorization(expired.id)?.phase).toBe('expired');
    const restarted = createCliAuthorization('three', 'fixture-cli');
    getSqliteDatabase().prepare("UPDATE connector_cli_authorizations SET owner_id='other' WHERE id=?").run(restarted.id);
    expect(readCliAuthorization(restarted.id)?.phase).toBe('failed');
  });
});
