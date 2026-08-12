import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';

import type { EventEnvelope } from './types.js';

interface EventRow {
  event_id: string;
  type: string;
  schema_version: number;
  source_kind: string;
  source_id: string;
  device_id: string | null;
  subject_kind: string;
  subject_id: string;
  actor_kind: EventEnvelope['actor']['kind'];
  actor_id: string | null;
  workspace_id: string;
  project_id: string | null;
  agent_id: string | null;
  occurred_at: string;
  observed_at: string;
  correlation_id: string;
  causation_id: string | null;
  dedupe_key: string;
  sensitivity: EventEnvelope['sensitivity'];
  payload_json: string;
}

function fromRow(row: EventRow): EventEnvelope {
  return {
    id: row.event_id,
    type: row.type,
    schemaVersion: row.schema_version,
    source: { kind: row.source_kind, id: row.source_id, ...(row.device_id ? { deviceId: row.device_id } : {}) },
    subject: { kind: row.subject_kind, id: row.subject_id },
    actor: { kind: row.actor_kind, ...(row.actor_id ? { id: row.actor_id } : {}) },
    scope: {
      workspaceId: row.workspace_id,
      ...(row.project_id ? { projectId: row.project_id } : {}),
      ...(row.agent_id ? { agentId: row.agent_id } : {}),
    },
    occurredAt: row.occurred_at,
    observedAt: row.observed_at,
    correlationId: row.correlation_id,
    ...(row.causation_id ? { causationId: row.causation_id } : {}),
    dedupeKey: row.dedupe_key,
    sensitivity: row.sensitivity,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
  };
}

export function getEventByDedupeKey(dedupeKey: string): EventEnvelope | null {
  const row = getSqliteDatabase().prepare(
    'SELECT * FROM proactive_events WHERE dedupe_key = ?',
  ).get(dedupeKey) as unknown as EventRow | undefined;
  return row ? fromRow(row) : null;
}

export function insertEvent(event: EventEnvelope): boolean {
  return runSqliteWriteTransaction((db) => {
    const result = db.prepare(`INSERT OR IGNORE INTO proactive_events (
      event_id, type, schema_version, source_kind, source_id, device_id,
      subject_kind, subject_id, actor_kind, actor_id, workspace_id, project_id, agent_id,
      occurred_at, observed_at, correlation_id, causation_id, dedupe_key, sensitivity, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        event.id, event.type, event.schemaVersion, event.source.kind, event.source.id,
        event.source.deviceId ?? null, event.subject.kind, event.subject.id, event.actor.kind,
        event.actor.id ?? null, event.scope.workspaceId, event.scope.projectId ?? null,
        event.scope.agentId ?? null, event.occurredAt, event.observedAt, event.correlationId,
        event.causationId ?? null, event.dedupeKey, event.sensitivity, JSON.stringify(event.payload),
      );
    return result.changes === 1;
  });
}

export function isEventRouted(eventId: string): boolean {
  const row = getSqliteDatabase().prepare(
    'SELECT routed_at FROM proactive_events WHERE event_id = ?',
  ).get(eventId) as { routed_at: string | null } | undefined;
  return Boolean(row?.routed_at);
}

export function markEventRouted(eventId: string, routedAt: string): void {
  runSqliteWriteTransaction((db) => {
    db.prepare('UPDATE proactive_events SET routed_at = COALESCE(routed_at, ?) WHERE event_id = ?')
      .run(routedAt, eventId);
  });
}

export function listEvents(input: { limit?: number; type?: string } = {}): EventEnvelope[] {
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const rows = input.type
    ? getSqliteDatabase().prepare('SELECT * FROM proactive_events WHERE type = ? ORDER BY observed_at DESC LIMIT ?').all(input.type, limit)
    : getSqliteDatabase().prepare('SELECT * FROM proactive_events ORDER BY observed_at DESC LIMIT ?').all(limit);
  return (rows as unknown as EventRow[]).map(fromRow);
}
