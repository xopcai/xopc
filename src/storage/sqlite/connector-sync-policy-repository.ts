import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export type ConnectorSyncPolicy = {
  accountId: string;
  scanEnabled: boolean;
  intervalMinutes?: number;
  revision: number;
  updatedAt: string;
};

type PolicyRow = {
  account_id: string;
  scan_enabled: number;
  interval_minutes: number | null;
  revision: number;
  updated_at: number;
};

function fromRow(row: PolicyRow): ConnectorSyncPolicy {
  return {
    accountId: row.account_id,
    scanEnabled: row.scan_enabled === 1,
    ...(row.interval_minutes == null ? {} : { intervalMinutes: row.interval_minutes }),
    revision: row.revision,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function getConnectorSyncPolicy(accountId: string): ConnectorSyncPolicy | undefined {
  const row = getSqliteDatabase().prepare(
    'SELECT * FROM connector_sync_policies WHERE account_id = ?',
  ).get(accountId) as PolicyRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function getConnectorSyncPolicyForConnection(connectionId: string): ConnectorSyncPolicy | undefined {
  const row = getSqliteDatabase().prepare(`
    SELECT connector_sync_policies.*
    FROM connector_sync_policies
    JOIN connector_connections
      ON connector_connections.account_id = connector_sync_policies.account_id
    WHERE connector_connections.id = ?
  `).get(connectionId) as PolicyRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function listConnectorSyncPolicies(): ConnectorSyncPolicy[] {
  const rows = getSqliteDatabase().prepare(
    'SELECT * FROM connector_sync_policies ORDER BY account_id ASC',
  ).all() as PolicyRow[];
  return rows.map(fromRow);
}

export function upsertConnectorSyncPolicy(input: {
  accountId: string;
  scanEnabled?: boolean;
  intervalMinutes?: number | null;
  defaultIntervalMinutes?: number;
  nowMs?: number;
}): ConnectorSyncPolicy {
  const current = getConnectorSyncPolicy(input.accountId);
  const now = input.nowMs ?? Date.now();
  const intervalMinutes = input.intervalMinutes === null
    ? null
    : Math.max(5, Math.min(
      1_440,
      input.intervalMinutes ?? current?.intervalMinutes ?? input.defaultIntervalMinutes ?? 30,
    ));

  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO connector_sync_policies (
        account_id, scan_enabled, interval_minutes, revision, updated_at
      ) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        scan_enabled = excluded.scan_enabled,
        interval_minutes = excluded.interval_minutes,
        revision = connector_sync_policies.revision + 1,
        updated_at = excluded.updated_at`,
    ).run(
      input.accountId,
      (input.scanEnabled ?? current?.scanEnabled ?? false) ? 1 : 0,
      intervalMinutes,
      now,
    );
  });
  return getConnectorSyncPolicy(input.accountId)!;
}
