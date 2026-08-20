import type { ConnectorAccount } from '../../connectors/types.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

type AccountRow = {
  id: string;
  connector_id: string;
  principal_id: string;
  identity_key: string | null;
  identity_json: string;
  current_connection_id: string | null;
  created_at: string;
  updated_at: string;
};

function parseIdentity(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function fromRow(row: AccountRow): ConnectorAccount {
  return {
    id: row.id,
    connectorId: row.connector_id,
    principalId: row.principal_id,
    identityKey: row.identity_key ?? undefined,
    identity: parseIdentity(row.identity_json),
    currentConnectionId: row.current_connection_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mergeAccountSourceData(
  db: ReturnType<typeof getSqliteDatabase>,
  connectorId: string,
  sourceAccountId: string,
  targetAccountId: string,
): void {
  const sourceId = `composio:${connectorId}:${sourceAccountId}`;
  const targetId = `composio:${connectorId}:${targetAccountId}`;
  db.prepare(`
    DELETE FROM knowledge_source_items AS source
    WHERE source.source_instance_id = ?
      AND EXISTS (
        SELECT 1 FROM knowledge_source_items AS target
        WHERE target.source_instance_id = ?
          AND target.collection_scope = source.collection_scope
          AND target.external_id = source.external_id
      )
  `).run(sourceId, targetId);
  db.prepare('UPDATE knowledge_source_items SET source_instance_id = ? WHERE source_instance_id = ?')
    .run(targetId, sourceId);
  db.prepare('UPDATE knowledge_sync_runs SET source_instance_id = ? WHERE source_instance_id = ?')
    .run(targetId, sourceId);
  db.prepare('UPDATE knowledge_source_changes SET source_instance_id = ? WHERE source_instance_id = ?')
    .run(targetId, sourceId);
  db.prepare('UPDATE user_claim_evidence SET source_instance_id = ? WHERE source_instance_id = ?')
    .run(targetId, sourceId);
  db.prepare(`
    DELETE FROM knowledge_collection_state AS source
    WHERE source.source_instance_id = ?
      AND EXISTS (
        SELECT 1 FROM knowledge_collection_state AS target
        WHERE target.source_instance_id = ?
          AND target.collection_scope = source.collection_scope
      )
  `).run(sourceId, targetId);
  db.prepare('UPDATE knowledge_collection_state SET source_instance_id = ? WHERE source_instance_id = ?')
    .run(targetId, sourceId);
  db.prepare(`
    INSERT INTO knowledge_consumer_watermarks (
      consumer_id, source_instance_id, last_sequence, updated_at
    )
    SELECT consumer_id, ?, last_sequence, updated_at
    FROM knowledge_consumer_watermarks
    WHERE source_instance_id = ?
    ON CONFLICT(consumer_id, source_instance_id) DO UPDATE SET
      last_sequence = MAX(last_sequence, excluded.last_sequence),
      updated_at = MAX(updated_at, excluded.updated_at)
  `).run(targetId, sourceId);
  db.prepare('DELETE FROM knowledge_consumer_watermarks WHERE source_instance_id = ?').run(sourceId);
  db.prepare(`
    UPDATE memory_records
    SET source_json = json_set(source_json, '$.sourceInstanceId', ?)
    WHERE json_extract(source_json, '$.sourceInstanceId') = ?
  `).run(targetId, sourceId);
  db.prepare(`
    UPDATE connector_learning_jobs
    SET source_instance_id = ?
    WHERE account_id = ?
  `).run(targetId, sourceAccountId);
}

export function getConnectorAccount(id: string): ConnectorAccount | undefined {
  const row = getSqliteDatabase().prepare('SELECT * FROM connector_accounts WHERE id = ?')
    .get(id) as AccountRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function listConnectorAccounts(options: { principalId?: string; connectorId?: string } = {}): ConnectorAccount[] {
  const clauses: string[] = [];
  const values: string[] = [];
  if (options.principalId) { clauses.push('principal_id = ?'); values.push(options.principalId); }
  if (options.connectorId) { clauses.push('connector_id = ?'); values.push(options.connectorId); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = getSqliteDatabase().prepare(`SELECT * FROM connector_accounts${where} ORDER BY updated_at DESC`)
    .all(...values) as AccountRow[];
  return rows.map(fromRow);
}

export function refreshConnectorAccountCurrent(accountId: string): ConnectorAccount | undefined {
  const now = new Date().toISOString();
  runSqliteWriteTransaction((db) => {
    const primary = db.prepare(`
      SELECT id FROM connector_connections
      WHERE account_id = ?
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
               COALESCE(connected_at, updated_at) DESC
      LIMIT 1
    `).get(accountId) as { id: string } | undefined;
    if (primary) {
      db.prepare(`
        UPDATE connector_accounts
        SET current_connection_id = ?, updated_at = ?
        WHERE id = ? AND current_connection_id IS NOT ?
      `).run(primary.id, now, accountId, primary.id);
    }
  });
  return getConnectorAccount(accountId);
}

export function reconcileConnectorAccount(input: {
  connectionId: string;
  identityKey: string;
  identity: Record<string, unknown>;
}): ConnectorAccount {
  const now = new Date().toISOString();
  const accountId = runSqliteWriteTransaction((db) => {
    const connection = db.prepare(
      'SELECT account_id, connector_id, principal_id FROM connector_connections WHERE id = ?',
    ).get(input.connectionId) as { account_id: string; connector_id: string; principal_id: string } | undefined;
    if (!connection?.account_id) throw new Error(`Connector connection not found: ${input.connectionId}`);

    const matched = db.prepare(`
      SELECT id FROM connector_accounts
      WHERE principal_id = ? AND connector_id = ? AND identity_key = ?
    `).get(connection.principal_id, connection.connector_id, input.identityKey) as { id: string } | undefined;
    const targetId = matched?.id ?? connection.account_id;

    if (targetId !== connection.account_id) {
      mergeAccountSourceData(db, connection.connector_id, connection.account_id, targetId);
      const targetPolicy = db.prepare('SELECT 1 FROM connector_sync_policies WHERE account_id = ?').get(targetId);
      if (targetPolicy) {
        db.prepare('DELETE FROM connector_sync_policies WHERE account_id = ?').run(connection.account_id);
      } else {
        db.prepare('UPDATE connector_sync_policies SET account_id = ? WHERE account_id = ?')
          .run(targetId, connection.account_id);
      }
      db.prepare('UPDATE connector_learning_jobs SET account_id = ? WHERE account_id = ?')
        .run(targetId, connection.account_id);
      db.prepare('UPDATE connector_connections SET account_id = ? WHERE account_id = ?')
        .run(targetId, connection.account_id);
      db.prepare('DELETE FROM connector_accounts WHERE id = ?').run(connection.account_id);
    }

    const primary = db.prepare(`
      SELECT id FROM connector_connections
      WHERE account_id = ?
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
               COALESCE(connected_at, updated_at) DESC
      LIMIT 1
    `).get(targetId) as { id: string } | undefined;
    if (!primary) throw new Error(`Connector account has no authorizations: ${targetId}`);
    db.prepare(`
      UPDATE connector_accounts
      SET identity_key = ?, identity_json = ?, current_connection_id = ?, updated_at = ?
      WHERE id = ?
    `).run(input.identityKey, JSON.stringify(input.identity), primary.id, now, targetId);
    return targetId;
  });
  return getConnectorAccount(accountId)!;
}
