import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { getConnectorAccount } from '../../storage/sqlite/connector-account-repository.js';
import { upsertConnectorConnection } from '../../storage/sqlite/connector-repository.js';
import type { CliChallenge, CliIdentity } from './types.js';

export const cliOwnerId = `${process.pid}:${randomUUID()}`;

function ownerAlive(ownerId: string): boolean {
  if (ownerId === cliOwnerId) return true;
  const pid = Number(ownerId.split(':')[0]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
export type CliAuthorization = {
  id: string; instance_id: string; connector_id: string; principal_id: string;
  expected_account_id: string | null; context_id: string;
  phase: 'preparing' | 'awaiting_user' | 'verifying' | 'succeeded' | 'failed' | 'expired' | 'cancelled';
  challenge_json: string | null; error: string | null; account_id: string | null;
  owner_id: string; expires_at: number; updated_at: number;
};

export function readCliAuthorization(id: string, principalId = 'local-owner'): CliAuthorization | undefined {
  const db = getSqliteDatabase();
  const row = db.prepare('SELECT * FROM connector_cli_authorizations WHERE id = ? AND principal_id = ?').get(id, principalId) as CliAuthorization | undefined;
  if (row && ['preparing', 'awaiting_user', 'verifying'].includes(row.phase) && (row.expires_at <= Date.now() || !ownerAlive(row.owner_id))) {
    const phase = row.expires_at <= Date.now() ? 'expired' : 'failed';
    updateCliAuthorization(row.id, { phase, error: phase === 'expired' ? 'Authorization expired.' : 'Gateway restarted. Start authorization again.' });
    return { ...row, phase, challenge_json: null, error: 'Start authorization again.' };
  }
  return row;
}

export function createCliAuthorization(instanceId: string, connectorId: string, expectedAccountId?: string): CliAuthorization {
  const db = getSqliteDatabase();
  const pending = db.prepare("SELECT id FROM connector_cli_authorizations WHERE instance_id = ? AND principal_id = 'local-owner' AND phase IN ('preparing','awaiting_user','verifying')").get(instanceId) as { id: string } | undefined;
  if (pending) {
    const current = readCliAuthorization(pending.id);
    if (current && ['preparing', 'awaiting_user', 'verifying'].includes(current.phase)) throw new Error('Authorization is already in progress.');
  }
  if (expectedAccountId) {
    const account = getConnectorAccount(expectedAccountId);
    if (!account || account.principalId !== 'local-owner' || account.connectorId !== connectorId || account.runtimeInstanceId !== instanceId) throw new Error('Account not found.');
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO connector_cli_authorizations
    (id, instance_id, connector_id, principal_id, expected_account_id, context_id, phase, owner_id, expires_at, updated_at)
    VALUES (?, ?, ?, 'local-owner', ?, ?, 'preparing', ?, ?, ?)`)
    .run(id, instanceId, connectorId, expectedAccountId ?? null, id, cliOwnerId, Date.now() + 10 * 60_000, Date.now());
  return readCliAuthorization(id)!;
}

export function updateCliAuthorization(id: string, input: { phase: CliAuthorization['phase']; challenge?: CliChallenge; error?: string; accountId?: string }): boolean {
  return getSqliteDatabase().prepare(`UPDATE connector_cli_authorizations SET phase = ?, challenge_json = ?, error = ?, account_id = COALESCE(?, account_id), updated_at = ?
    WHERE id = ? AND phase IN ('preparing','awaiting_user','verifying')`)
    .run(input.phase, input.challenge ? JSON.stringify(input.challenge) : null, input.error ?? null, input.accountId ?? null, Date.now(), id).changes > 0;
}

export function commitCliIdentity(attempt: CliAuthorization, identity: CliIdentity): string {
  return runSqliteWriteTransaction(db => {
    const current = readCliAuthorization(attempt.id);
    if (!current || current.phase !== 'verifying') throw new Error('Authorization is no longer active.');
    const previous = attempt.expected_account_id ? getConnectorAccount(attempt.expected_account_id) : undefined;
    if (attempt.expected_account_id && (!previous || previous.principalId !== attempt.principal_id || previous.runtimeInstanceId !== attempt.instance_id)) throw new Error('Selected account is no longer available.');
    if (previous && previous.identityKey !== identity.key) throw new Error('Authorized identity does not match the selected account.');
    const match = db.prepare('SELECT id FROM connector_accounts WHERE principal_id = ? AND runtime_instance_id = ? AND identity_key = ?')
      .get(attempt.principal_id, attempt.instance_id, identity.key) as { id: string } | undefined;
    const accountId = previous?.id ?? match?.id ?? randomUUID();
    const connectionId = randomUUID();
    upsertConnectorConnection({ id: connectionId, accountId, installationId: `${attempt.connector_id}-local-owner`, connectorId: attempt.connector_id,
      provider: 'cli', principalId: attempt.principal_id, providerConnectionId: attempt.context_id, identity: identity.identity,
      status: 'active', isDefault: false, connectedAt: new Date().toISOString(),
      metadata: { runtimeInstanceId: attempt.instance_id, contextId: attempt.context_id, scopes: identity.scopes } });
    db.prepare(`UPDATE connector_accounts SET runtime_instance_id = ?, identity_key = ?, identity_json = ?,
      enabled = 1, label = COALESCE(label, ?), current_connection_id = ?, updated_at = ? WHERE id = ?`)
      .run(attempt.instance_id, identity.key, JSON.stringify(identity.identity), identity.label, connectionId, new Date().toISOString(), accountId);
    db.prepare("UPDATE connector_connections SET status = 'disabled' WHERE account_id = ? AND id <> ? AND provider = 'cli'").run(accountId, connectionId);
    updateCliAuthorization(attempt.id, { phase: 'succeeded', accountId });
    return accountId;
  });
}

export function cliAuthorizationView(row: CliAuthorization) {
  return { id: row.id, status: row.phase, challenge: row.challenge_json ? JSON.parse(row.challenge_json) as CliChallenge : undefined,
    error: row.error ?? undefined, accountId: row.account_id ?? undefined, expiresAt: row.expires_at };
}

export function recoverCliExecutions(): void {
  const db = getSqliteDatabase();
  const owners = db.prepare("SELECT DISTINCT owner_id FROM connector_cli_executions WHERE status = 'running' AND owner_id <> ?").all(cliOwnerId) as Array<{ owner_id: string }>;
  for (const owner of owners) if (!ownerAlive(owner.owner_id)) db.prepare("UPDATE connector_cli_executions SET status = 'unknown', error_kind = 'interrupted', finished_at = ? WHERE status = 'running' AND owner_id = ?").run(Date.now(), owner.owner_id);
}
