import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { getAutomation, listAutomations } from '../storage/index.js';
import type {
  Automation,
  AutomationEvent,
  AutomationEventDeliveryStatus,
  AutomationEventEnvelope,
  AutomationEventRecord,
  AutomationRunStatus,
} from '../domain/types.js';

type EventRow = {
  event_id: string;
  event_type: string;
  schema_version: number;
  source: string;
  subject_kind: string | null;
  subject_id: string | null;
  occurred_at_ms: number;
  ingested_at_ms: number;
  correlation_id: string;
  causation_id: string | null;
  root_event_id: string;
  chain_depth: number;
  dedupe_key: string | null;
  trust: AutomationEventEnvelope['trust'];
  payload_json: string;
  projected_at_ms: number | null;
  projection_attempts: number;
  projection_error: string | null;
};

export interface PendingAutomationEventDelivery {
  event: AutomationEventEnvelope;
  automationId: string;
  attempts: number;
}

export interface AutomationEventIngestResult {
  event: AutomationEventEnvelope;
  created: boolean;
  deliveryCount: number;
}

export interface AutomationEventIngestOptions {
  targetAutomationIds?: string[];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function sameEventIdentity(
  existing: AutomationEventEnvelope,
  candidate: AutomationEventEnvelope,
  input: AutomationEvent,
): boolean {
  return existing.id === candidate.id
    && existing.type === candidate.type
    && existing.source === candidate.source
    && existing.schemaVersion === candidate.schemaVersion
    && existing.subject?.kind === candidate.subject?.kind
    && existing.subject?.id === candidate.subject?.id
    && (input.occurredAtMs === undefined || existing.occurredAtMs === candidate.occurredAtMs)
    && (input.correlationId === undefined || existing.correlationId === candidate.correlationId)
    && (input.causationId === undefined || existing.causationId === candidate.causationId)
    && (input.rootEventId === undefined || existing.rootEventId === candidate.rootEventId)
    && (input.chainDepth === undefined || existing.chainDepth === candidate.chainDepth)
    && existing.dedupeKey === candidate.dedupeKey
    && existing.trust === candidate.trust
    && stableStringify(existing.payload) === stableStringify(candidate.payload);
}

function matchesEvent(
  trigger: Extract<Automation['trigger'], { kind: 'event' }>,
  event: AutomationEventEnvelope,
): boolean {
  if (trigger.eventType !== event.type) return false;
  if (trigger.source && trigger.source !== event.source) return false;
  if (!trigger.payloadMatch) return true;
  return Object.entries(trigger.payloadMatch).every(([key, expected]) => Object.is(event.payload[key], expected));
}

function rowToEvent(row: EventRow): AutomationEventEnvelope {
  return {
    id: row.event_id,
    type: row.event_type,
    schemaVersion: row.schema_version,
    source: row.source,
    ...(row.subject_kind && row.subject_id ? { subject: { kind: row.subject_kind, id: row.subject_id } } : {}),
    occurredAtMs: row.occurred_at_ms,
    ingestedAtMs: row.ingested_at_ms,
    correlationId: row.correlation_id,
    ...(row.causation_id ? { causationId: row.causation_id } : {}),
    rootEventId: row.root_event_id,
    chainDepth: row.chain_depth,
    ...(row.dedupe_key ? { dedupeKey: row.dedupe_key } : {}),
    trust: row.trust,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
  };
}

function readEventByIdentity(input: { id: string; source: string; dedupeKey?: string }): AutomationEventEnvelope | null {
  const db = getSqliteDatabase();
  const row = (input.dedupeKey
    ? db.prepare(`SELECT * FROM automation_events WHERE event_id = ? OR (source = ? AND dedupe_key = ?) LIMIT 1`)
      .get(input.id, input.source, input.dedupeKey)
    : db.prepare('SELECT * FROM automation_events WHERE event_id = ?').get(input.id)) as EventRow | undefined;
  return row ? rowToEvent(row) : null;
}

export function ingestAutomationEvent(
  input: AutomationEvent,
  options: AutomationEventIngestOptions = {},
): AutomationEventIngestResult {
  if (!input.type.trim()) throw new Error('Automation event type is required');
  const now = Date.now();
  const id = input.id?.trim() || randomUUID();
  const source = input.source?.trim() || 'xopc';
  const event: AutomationEventEnvelope = {
    ...input,
    id,
    type: input.type.trim(),
    source,
    schemaVersion: input.schemaVersion ?? 1,
    occurredAtMs: input.occurredAtMs ?? now,
    ingestedAtMs: now,
    correlationId: input.correlationId?.trim() || id,
    rootEventId: input.rootEventId?.trim() || id,
    chainDepth: input.chainDepth ?? 0,
    trust: input.trust ?? (source.startsWith('composio') ? 'connector' : 'system'),
    payload: input.payload ?? {},
  };
  if (!Number.isInteger(event.schemaVersion) || event.schemaVersion < 1) throw new Error('Invalid event schema version');
  if (!Number.isInteger(event.chainDepth) || event.chainDepth < 0 || event.chainDepth > 32) throw new Error('Invalid event chain depth');

  return runSqliteWriteTransaction((db) => {
    const inserted = db.prepare(`INSERT OR IGNORE INTO automation_events (
      event_id, event_type, schema_version, source, subject_kind, subject_id,
      occurred_at_ms, ingested_at_ms, correlation_id, causation_id, root_event_id,
      chain_depth, dedupe_key, trust, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      event.id, event.type, event.schemaVersion, event.source,
      event.subject?.kind ?? null, event.subject?.id ?? null,
      event.occurredAtMs, event.ingestedAtMs, event.correlationId,
      event.causationId ?? null, event.rootEventId, event.chainDepth,
      event.dedupeKey ?? null, event.trust, JSON.stringify(event.payload),
    ).changes > 0;
    if (!inserted) {
      const existing = readEventByIdentity({ id: event.id, source: event.source, dedupeKey: event.dedupeKey });
      if (!existing) throw new Error('Automation event identity conflict');
      if (!sameEventIdentity(existing, event, input)) throw new Error('Automation event identity reused with different content');
      const count = Number(db.prepare('SELECT count(*) AS count FROM automation_event_deliveries WHERE event_id = ?')
        .get(existing.id)?.count ?? 0);
      return { event: existing, created: false, deliveryCount: count };
    }

    const automations = options.targetAutomationIds
      ? options.targetAutomationIds.map(getAutomation).filter((automation): automation is Automation => Boolean(automation?.enabled))
      : listAutomations().filter(automation => automation.enabled
        && automation.trigger.kind === 'event'
        && matchesEvent(automation.trigger, event));
    const insertDelivery = db.prepare(`INSERT INTO automation_event_deliveries (
      event_id, automation_id, status, attempts, next_attempt_at_ms, created_at_ms, updated_at_ms
    ) VALUES (?, ?, 'pending', 0, ?, ?, ?)`);
    for (const automation of automations) insertDelivery.run(event.id, automation.id, now, now, now);
    return { event, created: true, deliveryCount: automations.length };
  });
}

export function listAutomationEvents(input: {
  type?: string;
  source?: string;
  subjectKind?: string;
  subjectId?: string;
  limit?: number;
  newestFirst?: boolean;
} = {}): AutomationEventEnvelope[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (input.type) { clauses.push('event_type = ?'); params.push(input.type); }
  if (input.source) { clauses.push('source = ?'); params.push(input.source); }
  if (input.subjectKind) { clauses.push('subject_kind = ?'); params.push(input.subjectKind); }
  if (input.subjectId) { clauses.push('subject_id = ?'); params.push(input.subjectId); }
  params.push(Math.max(1, Math.min(500, Math.floor(input.limit ?? 100))));
  const rows = getSqliteDatabase().prepare(`SELECT * FROM automation_events
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY ingested_at_ms ${input.newestFirst ? 'DESC' : 'ASC'}, event_id ${input.newestFirst ? 'DESC' : 'ASC'} LIMIT ?`).all(...params) as EventRow[];
  return rows.map(rowToEvent);
}

export function listAutomationEventRecords(input: {
  type?: string;
  source?: string;
  limit?: number;
} = {}): AutomationEventRecord[] {
  const events = listAutomationEvents({ ...input, newestFirst: true });
  const db = getSqliteDatabase();
  const readEventState = db.prepare(`SELECT projected_at_ms, projection_attempts, projection_error
    FROM automation_events WHERE event_id = ?`);
  const readDeliveries = db.prepare(`SELECT automation_id, status, run_id, attempts, last_error
    FROM automation_event_deliveries WHERE event_id = ? ORDER BY automation_id`);
  return events.map((event) => {
    const state = readEventState.get(event.id) as Pick<EventRow, 'projected_at_ms' | 'projection_attempts' | 'projection_error'>;
    const deliveries = readDeliveries.all(event.id) as Array<{
      automation_id: string;
      status: AutomationEventDeliveryStatus;
      run_id: string | null;
      attempts: number;
      last_error: string | null;
    }>;
    return {
      event,
      projected: state.projected_at_ms !== null,
      projectionAttempts: state.projection_attempts,
      projectionError: state.projection_error ?? undefined,
      deliveries: deliveries.map(delivery => ({
        automationId: delivery.automation_id,
        status: delivery.status,
        runId: delivery.run_id ?? undefined,
        attempts: delivery.attempts,
        lastError: delivery.last_error ?? undefined,
      })),
    };
  });
}

export function listUnprojectedAutomationEvents(limit = 100): AutomationEventEnvelope[] {
  const rows = getSqliteDatabase().prepare(`SELECT * FROM automation_events
    WHERE projected_at_ms IS NULL ORDER BY ingested_at_ms, event_id LIMIT ?`)
    .all(Math.max(1, Math.min(500, Math.floor(limit)))) as EventRow[];
  return rows.map(rowToEvent);
}

export function markAutomationEventProjected(eventId: string): void {
  getSqliteDatabase().prepare(`UPDATE automation_events SET projected_at_ms = ?,
    projection_attempts = projection_attempts + 1, projection_error = NULL WHERE event_id = ?`)
    .run(Date.now(), eventId);
}

export function recordAutomationEventProjectionFailure(eventId: string, error: unknown): void {
  getSqliteDatabase().prepare(`UPDATE automation_events SET projection_attempts = projection_attempts + 1,
    projection_error = ? WHERE event_id = ?`).run(error instanceof Error ? error.message : String(error), eventId);
}

export function listPendingAutomationEventDeliveries(limit: number): PendingAutomationEventDelivery[] {
  if (limit <= 0) return [];
  const rows = getSqliteDatabase().prepare(`SELECT e.*, d.automation_id, d.attempts
    FROM automation_event_deliveries d JOIN automation_events e ON e.event_id = d.event_id
    WHERE d.status = 'pending' AND d.next_attempt_at_ms <= ?
    ORDER BY d.created_at_ms, d.event_id, d.automation_id LIMIT ?`)
    .all(Date.now(), Math.min(100, Math.floor(limit))) as Array<EventRow & { automation_id: string; attempts: number }>;
  return rows.map(row => ({ event: rowToEvent(row), automationId: row.automation_id, attempts: row.attempts }));
}

export function getAutomationEventDeliveryRunId(eventId: string, automationId: string): string | null {
  const row = getSqliteDatabase().prepare(`SELECT run_id FROM automation_event_deliveries
    WHERE event_id = ? AND automation_id = ?`).get(eventId, automationId) as { run_id: string | null } | undefined;
  return row?.run_id ?? null;
}

export function getAutomationEventForRun(runId: string): AutomationEventEnvelope | null {
  const row = getSqliteDatabase().prepare(`SELECT e.* FROM automation_event_deliveries d
    JOIN automation_events e ON e.event_id = d.event_id WHERE d.run_id = ? LIMIT 1`).get(runId) as EventRow | undefined;
  return row ? rowToEvent(row) : null;
}

export function markAutomationEventDeliveryQueued(eventId: string, automationId: string, runId: string): void {
  const result = getSqliteDatabase().prepare(`UPDATE automation_event_deliveries
    SET status = 'queued', run_id = ?, attempts = attempts + 1, updated_at_ms = ?, last_error = NULL
    WHERE event_id = ? AND automation_id = ? AND status = 'pending'`)
    .run(runId, Date.now(), eventId, automationId);
  if (result.changes !== 1) throw new Error('Automation event delivery was already claimed');
}

export function deferAutomationEventDelivery(eventId: string, automationId: string, error: unknown, delayMs = 1_000): void {
  getSqliteDatabase().prepare(`UPDATE automation_event_deliveries SET attempts = attempts + 1,
    next_attempt_at_ms = ?, last_error = ?, updated_at_ms = ?
    WHERE event_id = ? AND automation_id = ? AND status = 'pending'`)
    .run(Date.now() + delayMs, error instanceof Error ? error.message : String(error), Date.now(), eventId, automationId);
}

export function skipAutomationEventDelivery(eventId: string, automationId: string, reason: string): void {
  getSqliteDatabase().prepare(`UPDATE automation_event_deliveries SET status = 'skipped',
    last_error = ?, updated_at_ms = ? WHERE event_id = ? AND automation_id = ? AND status = 'pending'`)
    .run(reason, Date.now(), eventId, automationId);
}

export function completeAutomationEventDelivery(runId: string, runStatus: AutomationRunStatus): void {
  const status: AutomationEventDeliveryStatus = runStatus === 'succeeded'
    ? 'completed'
    : runStatus === 'cancelled'
      ? 'cancelled'
      : 'failed';
  getSqliteDatabase().prepare(`UPDATE automation_event_deliveries SET status = ?, updated_at_ms = ?
    WHERE run_id = ? AND status = 'queued'`).run(status, Date.now(), runId);
}

export function reconcileAutomationEventDeliveries(): number {
  const result = getSqliteDatabase().prepare(`UPDATE automation_event_deliveries
    SET status = CASE
      WHEN (SELECT status FROM automation_runs WHERE run_id = automation_event_deliveries.run_id) = 'succeeded' THEN 'completed'
      WHEN (SELECT status FROM automation_runs WHERE run_id = automation_event_deliveries.run_id) = 'cancelled' THEN 'cancelled'
      ELSE 'failed'
    END,
    updated_at_ms = ?
    WHERE status = 'queued' AND run_id IN (
      SELECT run_id FROM automation_runs WHERE status IN ('succeeded', 'failed', 'cancelled', 'timeout')
    )`).run(Date.now());
  return Number(result.changes);
}
