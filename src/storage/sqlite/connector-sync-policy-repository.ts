import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export type ConnectorSyncPolicy = {
  connectionId: string;
  scanEnabled: boolean;
  proactiveEnabled: boolean;
  intervalMinutes?: number;
  allowedScenarioKeys: string[];
  revision: number;
  updatedAt: string;
};

type PolicyRow = {
  connection_id: string;
  scan_enabled: number;
  proactive_enabled: number;
  interval_minutes: number | null;
  allowed_scenario_keys_json: string;
  revision: number;
  updated_at: number;
};

function stringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function fromRow(row: PolicyRow): ConnectorSyncPolicy {
  return {
    connectionId: row.connection_id,
    scanEnabled: row.scan_enabled === 1,
    proactiveEnabled: row.proactive_enabled === 1,
    ...(row.interval_minutes == null ? {} : { intervalMinutes: row.interval_minutes }),
    allowedScenarioKeys: stringArray(row.allowed_scenario_keys_json),
    revision: row.revision,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function getConnectorSyncPolicy(connectionId: string): ConnectorSyncPolicy | undefined {
  const row = getSqliteDatabase().prepare(
    'SELECT * FROM connector_sync_policies WHERE connection_id = ?',
  ).get(connectionId) as PolicyRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function listConnectorSyncPolicies(): ConnectorSyncPolicy[] {
  const rows = getSqliteDatabase().prepare(
    'SELECT * FROM connector_sync_policies ORDER BY connection_id ASC',
  ).all() as PolicyRow[];
  return rows.map(fromRow);
}

export function upsertConnectorSyncPolicy(input: {
  connectionId: string;
  scanEnabled?: boolean;
  proactiveEnabled?: boolean;
  intervalMinutes?: number | null;
  defaultIntervalMinutes?: number;
  allowedScenarioKeys?: string[];
  nowMs?: number;
}): ConnectorSyncPolicy {
  const current = getConnectorSyncPolicy(input.connectionId);
  const now = input.nowMs ?? Date.now();
  const intervalMinutes = input.intervalMinutes === null
    ? null
    : Math.max(5, Math.min(
      1_440,
      input.intervalMinutes ?? current?.intervalMinutes ?? input.defaultIntervalMinutes ?? 30,
    ));
  const allowedScenarioKeys = [...new Set(
    (input.allowedScenarioKeys ?? current?.allowedScenarioKeys ?? [])
      .map((key) => key.trim())
      .filter(Boolean),
  )].sort();

  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO connector_sync_policies (
        connection_id, scan_enabled, proactive_enabled, interval_minutes,
        allowed_scenario_keys_json, revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(connection_id) DO UPDATE SET
        scan_enabled = excluded.scan_enabled,
        proactive_enabled = excluded.proactive_enabled,
        interval_minutes = excluded.interval_minutes,
        allowed_scenario_keys_json = excluded.allowed_scenario_keys_json,
        revision = connector_sync_policies.revision + 1,
        updated_at = excluded.updated_at`,
    ).run(
      input.connectionId,
      (input.scanEnabled ?? current?.scanEnabled ?? true) ? 1 : 0,
      (input.proactiveEnabled ?? current?.proactiveEnabled ?? false) ? 1 : 0,
      intervalMinutes,
      JSON.stringify(allowedScenarioKeys),
      now,
    );
  });
  return getConnectorSyncPolicy(input.connectionId)!;
}
