import { randomUUID } from 'node:crypto';

import type {
  ConnectorActionMetadata,
  ConnectorApprovalRecord,
  ConnectorConnection,
  ConnectorDefinition,
  ConnectorExecutionAuditRecord,
  ConnectorInstallationPolicy,
} from '../../connectors/types.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

type InstallationRow = {
  id: string;
  connector_id: string;
  principal_id: string;
  enabled: number;
  allowed_agent_ids_json: string;
  max_scope: ConnectorInstallationPolicy['maxScope'];
  confirmation_policy: ConnectorInstallationPolicy['confirmationPolicy'];
  selected_connection_ids_json: string;
  created_at: string;
  updated_at: string;
};

type ConnectionRow = {
  id: string;
  installation_id: string | null;
  connector_id: string;
  provider: string;
  principal_id: string;
  provider_connection_id: string;
  alias: string | null;
  identity_json: string;
  status: ConnectorConnection['status'];
  is_default: number;
  connected_at: string | null;
  expires_at: string | null;
  last_error: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type ActionRow = {
  connector_id: string;
  action_id: string;
  toolkit: string | null;
  scope: ConnectorActionMetadata['scope'];
  curated: number;
  input_schema_json: string | null;
  schema_version: string | null;
  cached_at: string;
};

type AuditRow = {
  id: string;
  installation_id: string | null;
  connection_id: string | null;
  connector_id: string;
  principal_id: string;
  agent_id: string | null;
  session_key: string | null;
  action_id: string;
  scope: ConnectorExecutionAuditRecord['scope'];
  decision: ConnectorExecutionAuditRecord['decision'];
  result_status: ConnectorExecutionAuditRecord['resultStatus'];
  duration_ms: number | null;
  error_code: string | null;
  created_at: string;
};

type CatalogRow = {
  connector_id: string;
  provider: string;
  definition_json: string;
  fetched_at: string;
  expires_at: string | null;
};

type ApprovalRow = {
  id: string;
  principal_id: string;
  connector_id: string;
  connection_id: string | null;
  agent_id: string | null;
  session_key: string | null;
  action_id: string;
  scope: ConnectorApprovalRecord['scope'];
  arguments_hash: string;
  arguments_preview_json: string;
  status: ConnectorApprovalRecord['status'];
  expires_at: string;
  created_at: string;
  decided_at: string | null;
  consumed_at: string | null;
};

export type CachedConnectorCatalogEntry = {
  connectorId: string;
  provider: string;
  definition: ConnectorDefinition;
  fetchedAt: string;
  expiresAt?: string;
};

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function installationFromRow(row: InstallationRow): ConnectorInstallationPolicy {
  return {
    id: row.id,
    connectorId: row.connector_id,
    principalId: row.principal_id,
    enabled: row.enabled === 1,
    allowedAgentIds: parseStringArray(row.allowed_agent_ids_json),
    maxScope: row.max_scope,
    confirmationPolicy: row.confirmation_policy,
    selectedConnectionIds: parseStringArray(row.selected_connection_ids_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function connectionFromRow(row: ConnectionRow): ConnectorConnection {
  return {
    id: row.id,
    installationId: row.installation_id ?? undefined,
    connectorId: row.connector_id,
    provider: row.provider,
    principalId: row.principal_id,
    providerConnectionId: row.provider_connection_id,
    alias: row.alias ?? undefined,
    identity: parseObject(row.identity_json),
    status: row.status,
    isDefault: row.is_default === 1,
    connectedAt: row.connected_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    lastError: row.last_error ?? undefined,
    metadata: parseObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function actionFromRow(row: ActionRow): ConnectorActionMetadata {
  return {
    connectorId: row.connector_id,
    actionId: row.action_id,
    toolkit: row.toolkit ?? undefined,
    scope: row.scope,
    curated: row.curated === 1,
    inputSchema: row.input_schema_json == null ? undefined : JSON.parse(row.input_schema_json),
    schemaVersion: row.schema_version ?? undefined,
    cachedAt: row.cached_at,
  };
}

function auditFromRow(row: AuditRow): ConnectorExecutionAuditRecord {
  return {
    id: row.id,
    installationId: row.installation_id ?? undefined,
    connectionId: row.connection_id ?? undefined,
    connectorId: row.connector_id,
    principalId: row.principal_id,
    agentId: row.agent_id ?? undefined,
    sessionKey: row.session_key ?? undefined,
    actionId: row.action_id,
    scope: row.scope,
    decision: row.decision,
    resultStatus: row.result_status,
    durationMs: row.duration_ms ?? undefined,
    errorCode: row.error_code ?? undefined,
    createdAt: row.created_at,
  };
}

function catalogFromRow(row: CatalogRow): CachedConnectorCatalogEntry | undefined {
  try {
    const definition = JSON.parse(row.definition_json) as ConnectorDefinition;
    if (!definition || typeof definition !== 'object' || definition.id !== row.connector_id) return undefined;
    return {
      connectorId: row.connector_id,
      provider: row.provider,
      definition,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at ?? undefined,
    };
  } catch {
    return undefined;
  }
}

function approvalFromRow(row: ApprovalRow): ConnectorApprovalRecord {
  return {
    id: row.id,
    principalId: row.principal_id,
    connectorId: row.connector_id,
    connectionId: row.connection_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    sessionKey: row.session_key ?? undefined,
    actionId: row.action_id,
    scope: row.scope,
    argumentsHash: row.arguments_hash,
    argumentsPreview: parseObject(row.arguments_preview_json),
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
    consumedAt: row.consumed_at ?? undefined,
  };
}

export function createConnectorApproval(
  input: Omit<ConnectorApprovalRecord, 'id' | 'status' | 'createdAt'> & Partial<Pick<ConnectorApprovalRecord, 'id' | 'status' | 'createdAt'>>,
): ConnectorApprovalRecord {
  const record: ConnectorApprovalRecord = {
    ...input,
    id: input.id ?? randomUUID(),
    status: input.status ?? 'pending',
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  runSqliteWriteTransaction((db) => {
    db.prepare(`
      INSERT INTO connector_approvals (
        id, principal_id, connector_id, connection_id, agent_id, session_key, action_id,
        scope, arguments_hash, arguments_preview_json, status, expires_at, created_at,
        decided_at, consumed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.principalId,
      record.connectorId,
      record.connectionId ?? null,
      record.agentId ?? null,
      record.sessionKey ?? null,
      record.actionId,
      record.scope,
      record.argumentsHash,
      JSON.stringify(record.argumentsPreview),
      record.status,
      record.expiresAt,
      record.createdAt,
      record.decidedAt ?? null,
      record.consumedAt ?? null,
    );
  });
  return record;
}

export function getConnectorApproval(id: string): ConnectorApprovalRecord | undefined {
  const row = getSqliteDatabase().prepare('SELECT * FROM connector_approvals WHERE id = ?').get(id) as ApprovalRow | undefined;
  return row ? approvalFromRow(row) : undefined;
}

export function listConnectorApprovals(options: {
  principalId?: string;
  sessionKey?: string;
  status?: ConnectorApprovalRecord['status'];
  limit?: number;
} = {}): ConnectorApprovalRecord[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (options.principalId) {
    clauses.push('principal_id = ?');
    values.push(options.principalId);
  }
  if (options.sessionKey) {
    clauses.push('session_key = ?');
    values.push(options.sessionKey);
  }
  if (options.status) {
    clauses.push('status = ?');
    values.push(options.status);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  values.push(Math.max(1, Math.min(options.limit ?? 100, 500)));
  const rows = getSqliteDatabase().prepare(
    `SELECT * FROM connector_approvals${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  ).all(...values) as ApprovalRow[];
  return rows.map(approvalFromRow);
}

export function decideConnectorApproval(id: string, decision: 'approved' | 'denied', now = new Date()): ConnectorApprovalRecord | undefined {
  return runSqliteWriteTransaction((db) => {
    const current = db.prepare('SELECT * FROM connector_approvals WHERE id = ?').get(id) as ApprovalRow | undefined;
    if (!current) return undefined;
    if (current.status !== 'pending' || Date.parse(current.expires_at) <= now.getTime()) {
      if (current.status === 'pending') {
        db.prepare("UPDATE connector_approvals SET status = 'expired', decided_at = ? WHERE id = ?")
          .run(now.toISOString(), id);
      }
      const updated = db.prepare('SELECT * FROM connector_approvals WHERE id = ?').get(id) as ApprovalRow;
      return approvalFromRow(updated);
    }
    db.prepare('UPDATE connector_approvals SET status = ?, decided_at = ? WHERE id = ?')
      .run(decision, now.toISOString(), id);
    const updated = db.prepare('SELECT * FROM connector_approvals WHERE id = ?').get(id) as ApprovalRow;
    return approvalFromRow(updated);
  });
}

export function consumeConnectorApproval(id: string, argumentsHash: string, now = new Date()): ConnectorApprovalRecord | undefined {
  return runSqliteWriteTransaction((db) => {
    const current = db.prepare('SELECT * FROM connector_approvals WHERE id = ?').get(id) as ApprovalRow | undefined;
    if (!current || current.arguments_hash !== argumentsHash) return undefined;
    if (current.status !== 'approved' || Date.parse(current.expires_at) <= now.getTime()) {
      if (current.status === 'approved' && Date.parse(current.expires_at) <= now.getTime()) {
        db.prepare("UPDATE connector_approvals SET status = 'expired' WHERE id = ?").run(id);
      }
      return undefined;
    }
    db.prepare("UPDATE connector_approvals SET status = 'consumed', consumed_at = ? WHERE id = ? AND status = 'approved'")
      .run(now.toISOString(), id);
    const updated = db.prepare('SELECT * FROM connector_approvals WHERE id = ?').get(id) as ApprovalRow;
    return approvalFromRow(updated);
  });
}

export function upsertConnectorCatalogEntry(input: CachedConnectorCatalogEntry): CachedConnectorCatalogEntry {
  runSqliteWriteTransaction((db) => {
    db.prepare(`
      INSERT INTO connector_catalog_entries (connector_id, provider, definition_json, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(connector_id) DO UPDATE SET
        provider = excluded.provider,
        definition_json = excluded.definition_json,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at
    `).run(
      input.connectorId,
      input.provider,
      JSON.stringify(input.definition),
      input.fetchedAt,
      input.expiresAt ?? null,
    );
  });
  return input;
}

export function getCachedConnectorCatalogEntry(connectorId: string): CachedConnectorCatalogEntry | undefined {
  const row = getSqliteDatabase().prepare(
    'SELECT * FROM connector_catalog_entries WHERE connector_id = ?',
  ).get(connectorId) as CatalogRow | undefined;
  return row ? catalogFromRow(row) : undefined;
}

export function listCachedConnectorCatalogEntries(provider?: string): CachedConnectorCatalogEntry[] {
  const rows = (provider
    ? getSqliteDatabase().prepare('SELECT * FROM connector_catalog_entries WHERE provider = ? ORDER BY connector_id').all(provider)
    : getSqliteDatabase().prepare('SELECT * FROM connector_catalog_entries ORDER BY provider, connector_id').all()) as CatalogRow[];
  return rows.flatMap((row) => {
    const entry = catalogFromRow(row);
    return entry ? [entry] : [];
  });
}

export function upsertConnectorInstallation(
  input: Omit<ConnectorInstallationPolicy, 'createdAt' | 'updatedAt'> & Partial<Pick<ConnectorInstallationPolicy, 'createdAt' | 'updatedAt'>>,
): ConnectorInstallationPolicy {
  const now = new Date().toISOString();
  return runSqliteWriteTransaction((db) => {
    db.prepare(`
      INSERT INTO connector_installations (
        id, connector_id, principal_id, enabled, allowed_agent_ids_json, max_scope,
        confirmation_policy, selected_connection_ids_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        connector_id = excluded.connector_id,
        principal_id = excluded.principal_id,
        enabled = excluded.enabled,
        allowed_agent_ids_json = excluded.allowed_agent_ids_json,
        max_scope = excluded.max_scope,
        confirmation_policy = excluded.confirmation_policy,
        selected_connection_ids_json = excluded.selected_connection_ids_json,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.connectorId,
      input.principalId,
      input.enabled ? 1 : 0,
      JSON.stringify(input.allowedAgentIds),
      input.maxScope,
      input.confirmationPolicy,
      JSON.stringify(input.selectedConnectionIds),
      input.createdAt ?? now,
      input.updatedAt ?? now,
    );
    return getConnectorInstallation(input.id)!;
  });
}

export function getConnectorInstallation(id: string): ConnectorInstallationPolicy | undefined {
  const row = getSqliteDatabase().prepare('SELECT * FROM connector_installations WHERE id = ?').get(id) as InstallationRow | undefined;
  return row ? installationFromRow(row) : undefined;
}

export function listConnectorInstallations(principalId?: string): ConnectorInstallationPolicy[] {
  const rows = (principalId
    ? getSqliteDatabase().prepare('SELECT * FROM connector_installations WHERE principal_id = ? ORDER BY connector_id').all(principalId)
    : getSqliteDatabase().prepare('SELECT * FROM connector_installations ORDER BY principal_id, connector_id').all()) as InstallationRow[];
  return rows.map(installationFromRow);
}

export function deleteConnectorInstallation(id: string): boolean {
  return runSqliteWriteTransaction((db) => db.prepare('DELETE FROM connector_installations WHERE id = ?').run(id).changes > 0);
}

export function upsertConnectorConnection(
  input: Omit<ConnectorConnection, 'createdAt' | 'updatedAt'> & Partial<Pick<ConnectorConnection, 'createdAt' | 'updatedAt'>>,
): ConnectorConnection {
  const now = new Date().toISOString();
  return runSqliteWriteTransaction((db) => {
    if (input.isDefault) {
      db.prepare('UPDATE connector_connections SET is_default = 0 WHERE principal_id = ? AND connector_id = ? AND id <> ?')
        .run(input.principalId, input.connectorId, input.id);
    }
    db.prepare(`
      INSERT INTO connector_connections (
        id, installation_id, connector_id, provider, principal_id, provider_connection_id,
        alias, identity_json, status, is_default, connected_at, expires_at, last_error,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        installation_id = excluded.installation_id,
        connector_id = excluded.connector_id,
        provider = excluded.provider,
        principal_id = excluded.principal_id,
        provider_connection_id = excluded.provider_connection_id,
        alias = excluded.alias,
        identity_json = excluded.identity_json,
        status = excluded.status,
        is_default = excluded.is_default,
        connected_at = excluded.connected_at,
        expires_at = excluded.expires_at,
        last_error = excluded.last_error,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.installationId ?? null,
      input.connectorId,
      input.provider,
      input.principalId,
      input.providerConnectionId,
      input.alias ?? null,
      JSON.stringify(input.identity),
      input.status,
      input.isDefault ? 1 : 0,
      input.connectedAt ?? null,
      input.expiresAt ?? null,
      input.lastError ?? null,
      JSON.stringify(input.metadata),
      input.createdAt ?? now,
      input.updatedAt ?? now,
    );
    return getConnectorConnection(input.id)!;
  });
}

export function getConnectorConnection(id: string): ConnectorConnection | undefined {
  const row = getSqliteDatabase().prepare('SELECT * FROM connector_connections WHERE id = ?').get(id) as ConnectionRow | undefined;
  return row ? connectionFromRow(row) : undefined;
}

export function listConnectorConnections(options: { principalId?: string; connectorId?: string } = {}): ConnectorConnection[] {
  const clauses: string[] = [];
  const values: string[] = [];
  if (options.principalId) {
    clauses.push('principal_id = ?');
    values.push(options.principalId);
  }
  if (options.connectorId) {
    clauses.push('connector_id = ?');
    values.push(options.connectorId);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = getSqliteDatabase().prepare(`SELECT * FROM connector_connections${where} ORDER BY is_default DESC, updated_at DESC`).all(...values) as ConnectionRow[];
  return rows.map(connectionFromRow);
}

export function deleteConnectorConnection(id: string): boolean {
  return runSqliteWriteTransaction((db) => db.prepare('DELETE FROM connector_connections WHERE id = ?').run(id).changes > 0);
}

export function upsertConnectorActionMetadata(input: ConnectorActionMetadata): ConnectorActionMetadata {
  return runSqliteWriteTransaction((db) => {
    db.prepare(`
      INSERT INTO connector_action_metadata (
        connector_id, action_id, toolkit, scope, curated, input_schema_json, schema_version, cached_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connector_id, action_id) DO UPDATE SET
        toolkit = excluded.toolkit,
        scope = excluded.scope,
        curated = excluded.curated,
        input_schema_json = excluded.input_schema_json,
        schema_version = excluded.schema_version,
        cached_at = excluded.cached_at
    `).run(
      input.connectorId,
      input.actionId,
      input.toolkit ?? null,
      input.scope,
      input.curated ? 1 : 0,
      input.inputSchema === undefined ? null : JSON.stringify(input.inputSchema),
      input.schemaVersion ?? null,
      input.cachedAt,
    );
    return input;
  });
}

export function listConnectorActionMetadata(connectorId: string): ConnectorActionMetadata[] {
  const rows = getSqliteDatabase().prepare(
    'SELECT * FROM connector_action_metadata WHERE connector_id = ? ORDER BY action_id',
  ).all(connectorId) as ActionRow[];
  return rows.map(actionFromRow);
}

export function appendConnectorExecutionAudit(
  input: Omit<ConnectorExecutionAuditRecord, 'id' | 'createdAt'> & Partial<Pick<ConnectorExecutionAuditRecord, 'id' | 'createdAt'>>,
): ConnectorExecutionAuditRecord {
  const record: ConnectorExecutionAuditRecord = {
    ...input,
    id: input.id ?? randomUUID(),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  runSqliteWriteTransaction((db) => {
    db.prepare(`
      INSERT INTO connector_execution_audit (
        id, installation_id, connection_id, connector_id, principal_id, agent_id,
        session_key, action_id, scope, decision, result_status, duration_ms, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.installationId ?? null,
      record.connectionId ?? null,
      record.connectorId,
      record.principalId,
      record.agentId ?? null,
      record.sessionKey ?? null,
      record.actionId,
      record.scope,
      record.decision,
      record.resultStatus,
      record.durationMs ?? null,
      record.errorCode ?? null,
      record.createdAt,
    );
  });
  return record;
}

export function listConnectorExecutionAudit(options: { principalId?: string; connectorId?: string; limit?: number } = {}): ConnectorExecutionAuditRecord[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (options.principalId) {
    clauses.push('principal_id = ?');
    values.push(options.principalId);
  }
  if (options.connectorId) {
    clauses.push('connector_id = ?');
    values.push(options.connectorId);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  values.push(Math.max(1, Math.min(options.limit ?? 100, 500)));
  const rows = getSqliteDatabase().prepare(
    `SELECT * FROM connector_execution_audit${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  ).all(...values) as AuditRow[];
  return rows.map(auditFromRow);
}

export function claimConnectorWebhookDelivery(input: {
  id: string;
  provider: string;
  payloadHash: string;
  now?: Date;
  leaseMs?: number;
}): 'claimed' | 'processed' | 'in_flight' {
  const now = input.now ?? new Date();
  return runSqliteWriteTransaction((db) => {
    const current = db.prepare('SELECT status, processing_at, payload_hash FROM connector_webhook_deliveries WHERE id = ?')
      .get(input.id) as { status: string; processing_at: string | null; payload_hash: string } | undefined;
    if (!current) {
      db.prepare(`
        INSERT INTO connector_webhook_deliveries (
          id, provider, payload_hash, status, attempts, received_at, processing_at
        ) VALUES (?, ?, ?, 'processing', 1, ?, ?)
      `).run(input.id, input.provider, input.payloadHash, now.toISOString(), now.toISOString());
      return 'claimed';
    }
    if (current.payload_hash !== input.payloadHash) throw new Error('Webhook delivery id was reused with a different payload.');
    if (current.status === 'processed') return 'processed';
    const leaseMs = input.leaseMs ?? 5 * 60_000;
    if (current.status === 'processing' && current.processing_at && Date.parse(current.processing_at) + leaseMs > now.getTime()) {
      return 'in_flight';
    }
    db.prepare(`
      UPDATE connector_webhook_deliveries
      SET status = 'processing', attempts = attempts + 1, processing_at = ?, last_error = NULL
      WHERE id = ?
    `).run(now.toISOString(), input.id);
    return 'claimed';
  });
}

export function completeConnectorWebhookDelivery(id: string, now = new Date()): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(`
      UPDATE connector_webhook_deliveries
      SET status = 'processed', processed_at = ?, processing_at = NULL, last_error = NULL
      WHERE id = ?
    `).run(now.toISOString(), id);
  });
}

export function releaseConnectorWebhookDelivery(id: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  runSqliteWriteTransaction((db) => {
    db.prepare(`
      UPDATE connector_webhook_deliveries
      SET status = 'pending', processing_at = NULL, last_error = ?
      WHERE id = ? AND status = 'processing'
    `).run(message.slice(0, 500), id);
  });
}
