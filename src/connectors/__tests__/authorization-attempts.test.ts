import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, upsertConnectorConnection } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { getAuthorizationAttempt, saveAuthorizationAttempt } from '../authorization-attempts.js';

describe('durable connector authorization', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });
  const connection = () => upsertConnectorConnection({ id: 'oauth', connectorId: 'composio-gmail', provider: 'composio',
    principalId: 'local-owner', providerConnectionId: 'ca-oauth', identity: {}, status: 'pending', isDefault: false, metadata: {} });

  it('keeps pending authorization private and clears its URL on success', () => {
    const record = connection();
    const id = saveAuthorizationAttempt({ connectionId: record.id, principalId: record.principalId, connectorId: record.connectorId, url: 'https://example.test/oauth' });
    expect(getAuthorizationAttempt(id, 'other')).toBeUndefined();
    expect(getAuthorizationAttempt(id, record.principalId)).toMatchObject({ status: 'awaiting_user', authorization_url: 'https://example.test/oauth' });
    upsertConnectorConnection({ ...record, status: 'active' });
    expect(getAuthorizationAttempt(id, record.principalId)).toMatchObject({ status: 'succeeded', authorization_url: null });
  });

  it('does not accept a different account when reconnecting', () => {
    const record = connection();
    const id = saveAuthorizationAttempt({ connectionId: record.id, principalId: record.principalId, connectorId: record.connectorId, expectedAccountId: 'expected', url: 'https://example.test/oauth' });
    upsertConnectorConnection({ ...record, status: 'active' });
    expect(getAuthorizationAttempt(id, record.principalId)).toMatchObject({ status: 'failed', expected_account_id: 'expected', authorization_url: null });
  });

  it('expires old attempts and allows their connection to be deleted', () => {
    const record = connection();
    const id = saveAuthorizationAttempt({ connectionId: record.id, principalId: record.principalId, connectorId: record.connectorId, url: 'https://example.test/oauth' });
    getSqliteDatabase().prepare('UPDATE connector_authorization_attempts SET expires_at = 0 WHERE id = ?').run(id);
    expect(getAuthorizationAttempt(id, record.principalId)).toMatchObject({ status: 'expired', authorization_url: null });
    getSqliteDatabase().prepare('DELETE FROM connector_connections WHERE id = ?').run(record.id);
    expect(getAuthorizationAttempt(id, record.principalId)).toBeUndefined();
  });
});
