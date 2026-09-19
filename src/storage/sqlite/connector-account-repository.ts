import type { ConnectorAccount } from '../../connectors/types.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

type AccountRow = {
  id: string;
  connector_id: string;
  principal_id: string;
  identity_key: string | null;
  backend_id: string | null;
  identity_json: string;
  current_connection_id: string | null;
  label: string | null;
  enabled: number;
  allowed_agent_ids_json: string | null;
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
    backendId: row.backend_id ?? undefined,
    identity: parseIdentity(row.identity_json),
    currentConnectionId: row.current_connection_id ?? undefined,
    label: row.label ?? undefined,
    enabled: row.enabled === 1,
    allowedAgentIds: row.allowed_agent_ids_json === null ? null : JSON.parse(row.allowed_agent_ids_json),
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
    UPDATE knowledge_items
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

export function updateConnectorAccount(id: string, patch: {
  label?: string; enabled?: boolean; allowedAgentIds?: string[] | null;
}): ConnectorAccount {
  const account = getConnectorAccount(id);
  if (!account) throw new Error('Connector account not found.');
  getSqliteDatabase().prepare(`UPDATE connector_accounts
    SET label = ?, enabled = ?, allowed_agent_ids_json = ?, updated_at = ? WHERE id = ?`).run(
    patch.label === undefined ? account.label ?? null : patch.label.trim() || null,
    (patch.enabled ?? account.enabled) ? 1 : 0,
    patch.allowedAgentIds === undefined
      ? account.allowedAgentIds === null ? null : JSON.stringify(account.allowedAgentIds)
      : patch.allowedAgentIds === null ? null : JSON.stringify([...new Set(patch.allowedAgentIds)]),
    new Date().toISOString(), id,
  );
  return getConnectorAccount(id)!;
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
      `SELECT c.account_id, c.connector_id, c.principal_id, a.backend_id FROM connector_connections c
       JOIN connector_accounts a ON a.id = c.account_id WHERE c.id = ?`,
    ).get(input.connectionId) as { account_id: string; connector_id: string; principal_id: string; backend_id: string | null } | undefined;
    if (!connection?.account_id) throw new Error(`Connector connection not found: ${input.connectionId}`);

    const matched = db.prepare(`
      SELECT id FROM connector_accounts
      WHERE principal_id = ? AND connector_id = ? AND identity_key = ? AND backend_id IS ?
    `).get(connection.principal_id, connection.connector_id, input.identityKey, connection.backend_id) as { id: string } | undefined;
    const targetId = matched?.id ?? connection.account_id;

    if (targetId !== connection.account_id) {
      db.prepare(`UPDATE connector_installations SET selected_account_ids_json = (
        SELECT json_group_array(DISTINCT CASE WHEN value = ? THEN ? ELSE value END)
        FROM json_each(connector_installations.selected_account_ids_json))
        WHERE json_type(selected_account_ids_json) = 'array'
        AND EXISTS (SELECT 1 FROM json_each(selected_account_ids_json) WHERE value = ?)`)
        .run(connection.account_id, targetId, connection.account_id);
      db.prepare(`INSERT OR IGNORE INTO connector_objective_accounts
        SELECT conversation_id, transcript_id, objective_id, connector_id, ?
        FROM connector_objective_accounts WHERE account_id = ?`).run(targetId, connection.account_id);
      // Reauthorization must not relax an existing account restriction.
      const source = getConnectorAccount(connection.account_id)!;
      const target = getConnectorAccount(targetId)!;
      const agents = source.allowedAgentIds === null ? target.allowedAgentIds
        : target.allowedAgentIds === null ? source.allowedAgentIds
          : target.allowedAgentIds.filter(id => source.allowedAgentIds!.includes(id));
      db.prepare(`UPDATE connector_accounts SET enabled = ?, allowed_agent_ids_json = ?, label = COALESCE(label, ?) WHERE id = ?`)
        .run(source.enabled && target.enabled ? 1 : 0, agents === null ? null : JSON.stringify(agents), source.label ?? null, targetId);
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
