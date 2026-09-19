import { getConnectorConnection } from '../storage/sqlite/connector-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export type AuthorizationAttempt = {
  id: string; principal_id: string; connector_id: string; backend_id: string | null;
  connection_id: string; expected_account_id: string | null; authorization_url: string | null;
  status: 'awaiting_user' | 'succeeded' | 'failed' | 'expired'; expires_at: number; created_at: number;
};

export function saveAuthorizationAttempt(input: {
  connectionId: string; principalId: string; connectorId: string; backendId?: string; expectedAccountId?: string; url?: string;
}): string {
  const now = Date.now();
  getSqliteDatabase().prepare(`INSERT INTO connector_authorization_attempts
    (id, principal_id, connector_id, backend_id, connection_id, expected_account_id, authorization_url, status, expires_at, created_at)
    VALUES(?,?,?,?,?,?,?,'awaiting_user',?,?)
    ON CONFLICT(id) DO UPDATE SET expected_account_id = excluded.expected_account_id,
      authorization_url = excluded.authorization_url, status = 'awaiting_user',
      expires_at = excluded.expires_at, created_at = excluded.created_at`).run(
    input.connectionId, input.principalId, input.connectorId, input.backendId ?? null, input.connectionId,
    input.expectedAccountId ?? null, input.url ?? null, now + 10 * 60_000, now,
  );
  return input.connectionId;
}

export function getAuthorizationAttempt(id: string, principalId: string): AuthorizationAttempt | undefined {
  const db = getSqliteDatabase();
  const row = db.prepare('SELECT * FROM connector_authorization_attempts WHERE id = ? AND principal_id = ?').get(id, principalId) as AuthorizationAttempt | undefined;
  if (!row || row.status !== 'awaiting_user') return row;
  const connection = getConnectorConnection(row.connection_id);
  const status = row.expires_at <= Date.now() ? 'expired'
    : connection?.status === 'active' ? (row.expected_account_id && row.expected_account_id !== connection.accountId ? 'failed' : 'succeeded')
      : connection && ['failed', 'revoked'].includes(connection.status) ? 'failed' : 'awaiting_user';
  if (status !== row.status) {
    db.prepare('UPDATE connector_authorization_attempts SET status = ?, authorization_url = NULL WHERE id = ?').run(status, id);
    return { ...row, status, authorization_url: null };
  }
  return row;
}
