import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import type {
  Automation,
  AutomationEvent,
  AutomationEventDeliveryStatus,
  AutomationEventEnvelope,
  AutomationEventProjectionStatus,
  AutomationEventRecord,
  AutomationRunStatus,
} from '../domain/types.js';
import { getAutomation, listAutomations } from '../storage/index.js';
import { validateCatalogedBusinessEvent } from './event-catalog.js';

const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 2 * 60_000, 10 * 60_000] as const;

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
  projection_status: AutomationEventProjectionStatus;
  projected_at_ms: number | null;
  projection_attempts: number;
  projection_next_attempt_at_ms: number;
  projection_error: string | null;
  projection_owner: string | null;
  projection_lease_until_ms: number | null;
};

export interface ClaimedAutomationEventDelivery {
  event: AutomationEventEnvelope;
  automationId: string;
  attempts: number;
  owner: string;
}

export interface AutomationEventIngestResult {
  event: AutomationEventEnvelope;
  created: boolean;
  deliveryCount: number;
}

export interface AutomationEventIngestOptions {
  targetAutomationIds?: string[];
}

export interface AutomationEventPublisher {
  publish(input: AutomationEvent, options?: AutomationEventIngestOptions): AutomationEventIngestResult;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function sameEventIdentity(existing: AutomationEventEnvelope, candidate: AutomationEventEnvelope, input: AutomationEvent): boolean {
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

function matchesEvent(trigger: Extract<Automation['trigger'], { kind: 'event' }>, event: AutomationEventEnvelope): boolean {
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
    ? db.prepare('SELECT * FROM automation_events WHERE event_id = ? OR (source = ? AND dedupe_key = ?) LIMIT 1')
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
  const payloadJson = JSON.stringify(event.payload);
  if (Buffer.byteLength(payloadJson) > MAX_PAYLOAD_BYTES) throw new Error(`Automation event payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  validateCatalogedBusinessEvent(event);

  return runSqliteWriteTransaction((db) => {
    const inserted = db.prepare(`INSERT OR IGNORE INTO automation_events (
      event_id, event_type, schema_version, source, subject_kind, subject_id,
      occurred_at_ms, ingested_at_ms, correlation_id, causation_id, root_event_id,
      chain_depth, dedupe_key, trust, payload_json, projection_next_attempt_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      event.id, event.type, event.schemaVersion, event.source,
      event.subject?.kind ?? null, event.subject?.id ?? null,
      event.occurredAtMs, event.ingestedAtMs, event.correlationId,
      event.causationId ?? null, event.rootEventId, event.chainDepth,
      event.dedupeKey ?? null, event.trust, payloadJson, now,
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

export const automationEventPublisher: AutomationEventPublisher = {
  publish: ingestAutomationEvent,
};

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
    ORDER BY ingested_at_ms ${input.newestFirst ? 'DESC' : 'ASC'}, rowid ${input.newestFirst ? 'DESC' : 'ASC'} LIMIT ?`)
    .all(...params) as EventRow[];
  return rows.map(rowToEvent);
}

export function listAutomationEventRecords(input: { type?: string; source?: string; limit?: number } = {}): AutomationEventRecord[] {
  const events = listAutomationEvents({ ...input, newestFirst: true });
  const db = getSqliteDatabase();
  const readEventState = db.prepare(`SELECT projection_status, projection_attempts, projection_error
    FROM automation_events WHERE event_id = ?`);
  const readDeliveries = db.prepare(`SELECT automation_id, status, run_id, attempts, last_error
    FROM automation_event_deliveries WHERE event_id = ? ORDER BY automation_id`);
  return events.map((event) => {
    const state = readEventState.get(event.id) as Pick<EventRow, 'projection_status' | 'projection_attempts' | 'projection_error'>;
    const deliveries = readDeliveries.all(event.id) as Array<{
      automation_id: string;
      status: AutomationEventDeliveryStatus;
      run_id: string | null;
      attempts: number;
      last_error: string | null;
    }>;
    return {
      event,
      projectionStatus: state.projection_status,
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

export function claimAutomationEventsForProjection(owner: string, limit = 100, leaseMs = 30_000): AutomationEventEnvelope[] {
  const now = Date.now();
  return runSqliteWriteTransaction((db) => {
    const candidates = db.prepare(`SELECT * FROM automation_events WHERE
      (projection_status IN ('pending', 'retrying') AND projection_next_attempt_at_ms <= ?)
      OR (projection_status = 'projecting' AND projection_lease_until_ms <= ?)
      ORDER BY ingested_at_ms, event_id LIMIT ?`).all(now, now, Math.max(1, Math.min(500, limit))) as EventRow[];
    const claimed: AutomationEventEnvelope[] = [];
    const statement = db.prepare(`UPDATE automation_events
      SET projection_status = 'projecting', projection_attempts = projection_attempts + 1,
          projection_owner = ?, projection_lease_until_ms = ?
      WHERE event_id = ? AND (
        (projection_status IN ('pending', 'retrying') AND projection_next_attempt_at_ms <= ?)
        OR (projection_status = 'projecting' AND projection_lease_until_ms <= ?)
      )`);
    for (const candidate of candidates) {
      if (statement.run(owner, now + leaseMs, candidate.event_id, now, now).changes === 1) claimed.push(rowToEvent(candidate));
    }
    return claimed;
  });
}

export function expireAutomationEventProjectionLeases(): Array<{ eventId: string; error: string }> {
  const now = Date.now();
  return runSqliteWriteTransaction((db) => {
    const candidates = db.prepare(`SELECT event_id FROM automation_events
      WHERE projection_status = 'projecting' AND projection_lease_until_ms <= ? AND projection_attempts >= ?`)
      .all(now, MAX_ATTEMPTS) as Array<{ event_id: string }>;
    const expire = db.prepare(`UPDATE automation_events
      SET projection_status = 'dead_letter', projection_error = 'Projection lease expired after maximum attempts',
          projection_owner = NULL, projection_lease_until_ms = NULL
      WHERE event_id = ? AND projection_status = 'projecting'
        AND projection_lease_until_ms <= ? AND projection_attempts >= ?`);
    const expired: Array<{ eventId: string; error: string }> = [];
    for (const candidate of candidates) {
      if (expire.run(candidate.event_id, now, MAX_ATTEMPTS).changes === 1) {
        expired.push({ eventId: candidate.event_id, error: 'Projection lease expired after maximum attempts' });
      }
    }
    return expired;
  });
}

export function completeAutomationEventProjection(eventId: string, owner: string): void {
  getSqliteDatabase().prepare(`UPDATE automation_events
    SET projection_status = 'projected', projected_at_ms = ?, projection_error = NULL,
        projection_owner = NULL, projection_lease_until_ms = NULL
    WHERE event_id = ? AND projection_status = 'projecting' AND projection_owner = ?`)
    .run(Date.now(), eventId, owner);
}

export function releaseAutomationEventProjection(eventId: string, owner: string): void {
  getSqliteDatabase().prepare(`UPDATE automation_events
    SET projection_status = 'retrying', projection_attempts = MAX(0, projection_attempts - 1),
        projection_next_attempt_at_ms = ?, projection_owner = NULL, projection_lease_until_ms = NULL
    WHERE event_id = ? AND projection_status = 'projecting' AND projection_owner = ?`)
    .run(Date.now(), eventId, owner);
}

export function failAutomationEventProjection(eventId: string, owner: string, error: unknown): AutomationEventProjectionStatus {
  const db = getSqliteDatabase();
  const row = db.prepare('SELECT projection_attempts FROM automation_events WHERE event_id = ? AND projection_owner = ?')
    .get(eventId, owner) as { projection_attempts: number } | undefined;
  if (!row) return 'retrying';
  const terminal = row.projection_attempts >= MAX_ATTEMPTS;
  const status: AutomationEventProjectionStatus = terminal ? 'dead_letter' : 'retrying';
  const delay = RETRY_DELAYS_MS[Math.min(row.projection_attempts - 1, RETRY_DELAYS_MS.length - 1)]!;
  db.prepare(`UPDATE automation_events SET projection_status = ?, projection_next_attempt_at_ms = ?,
    projection_error = ?, projection_owner = NULL, projection_lease_until_ms = NULL
    WHERE event_id = ? AND projection_status = 'projecting' AND projection_owner = ?`)
    .run(status, Date.now() + delay, error instanceof Error ? error.message : String(error), eventId, owner);
  return status;
}

export function claimAutomationEventDeliveries(owner: string, limit: number, leaseMs = 30_000): ClaimedAutomationEventDelivery[] {
  if (limit <= 0) return [];
  const now = Date.now();
  return runSqliteWriteTransaction((db) => {
    const rows = db.prepare(`SELECT e.*, d.automation_id, d.attempts
      FROM automation_event_deliveries d
      JOIN automation_events e ON e.event_id = d.event_id
      LEFT JOIN automations a ON a.automation_id = d.automation_id
      WHERE d.status IN ('pending', 'retrying') AND d.next_attempt_at_ms <= ?
        AND (d.lease_until_ms IS NULL OR d.lease_until_ms <= ?)
      ORDER BY CASE
        WHEN a.enabled = 1 AND json_extract(a.state_json, '$.runningRunId') IS NULL THEN 0
        WHEN a.automation_id IS NULL OR a.enabled = 0 THEN 1
        ELSE 2
      END, d.created_at_ms, d.event_id, d.automation_id LIMIT ?`)
      .all(now, now, Math.min(500, Math.floor(limit))) as Array<EventRow & { automation_id: string; attempts: number }>;
    const claimed: ClaimedAutomationEventDelivery[] = [];
    const statement = db.prepare(`UPDATE automation_event_deliveries SET lease_owner = ?, lease_until_ms = ?, updated_at_ms = ?
      WHERE event_id = ? AND automation_id = ? AND status IN ('pending', 'retrying')
        AND (lease_until_ms IS NULL OR lease_until_ms <= ?)`);
    for (const row of rows) {
      if (statement.run(owner, now + leaseMs, now, row.event_id, row.automation_id, now).changes === 1) {
        claimed.push({ event: rowToEvent(row), automationId: row.automation_id, attempts: row.attempts, owner });
      }
    }
    return claimed;
  });
}

export function releaseAutomationEventDelivery(eventId: string, automationId: string, owner: string, delayMs = 1_000): void {
  const now = Date.now();
  getSqliteDatabase().prepare(`UPDATE automation_event_deliveries SET next_attempt_at_ms = ?,
    lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ?
    WHERE event_id = ? AND automation_id = ? AND lease_owner = ? AND status IN ('pending', 'retrying')`)
    .run(now + delayMs, now, eventId, automationId, owner);
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

export function markAutomationEventDeliveryQueued(
  eventId: string,
  automationId: string,
  runId: string,
  owner?: string,
): void {
  const ownerClause = owner ? 'AND lease_owner = ?' : '';
  const params = owner
    ? [runId, Date.now(), eventId, automationId, owner]
    : [runId, Date.now(), eventId, automationId];
  const result = getSqliteDatabase().prepare(`UPDATE automation_event_deliveries
    SET status = 'queued', run_id = ?, attempts = attempts + 1, updated_at_ms = ?, last_error = NULL,
        lease_owner = NULL, lease_until_ms = NULL
    WHERE event_id = ? AND automation_id = ? AND status IN ('pending', 'retrying') ${ownerClause}`)
    .run(...params);
  if (result.changes !== 1) throw new Error('Automation event delivery was already claimed');
}

export function deferAutomationEventDelivery(
  eventId: string,
  automationId: string,
  owner: string,
  error: unknown,
): AutomationEventDeliveryStatus {
  const db = getSqliteDatabase();
  const row = db.prepare(`SELECT attempts FROM automation_event_deliveries
    WHERE event_id = ? AND automation_id = ? AND lease_owner = ?`).get(eventId, automationId, owner) as { attempts: number } | undefined;
  if (!row) return 'retrying';
  const attempts = row.attempts + 1;
  const terminal = attempts >= MAX_ATTEMPTS;
  const status: AutomationEventDeliveryStatus = terminal ? 'dead_letter' : 'retrying';
  const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)]!;
  db.prepare(`UPDATE automation_event_deliveries SET status = ?, attempts = ?, next_attempt_at_ms = ?,
    last_error = ?, lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ?
    WHERE event_id = ? AND automation_id = ? AND lease_owner = ?`)
    .run(status, attempts, Date.now() + delay, error instanceof Error ? error.message : String(error),
      Date.now(), eventId, automationId, owner);
  return status;
}

export function skipAutomationEventDelivery(eventId: string, automationId: string, reason: string, owner?: string): void {
  const ownerClause = owner ? 'AND lease_owner = ?' : '';
  getSqliteDatabase().prepare(`UPDATE automation_event_deliveries SET status = 'skipped',
    last_error = ?, lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ?
    WHERE event_id = ? AND automation_id = ? AND status IN ('pending', 'retrying') ${ownerClause}`)
    .run(reason, Date.now(), eventId, automationId, ...(owner ? [owner] : []));
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
    END, updated_at_ms = ?
    WHERE status = 'queued' AND run_id IN (
      SELECT run_id FROM automation_runs WHERE status IN ('succeeded', 'failed', 'cancelled', 'timeout')
    )`).run(Date.now());
  return Number(result.changes);
}

export function replayAutomationEvent(eventId: string): boolean {
  return runSqliteWriteTransaction((db) => {
    const now = Date.now();
    const projection = db.prepare(`UPDATE automation_events SET projection_status = 'retrying',
      projection_attempts = 0, projection_next_attempt_at_ms = ?, projection_error = NULL,
      projection_owner = NULL, projection_lease_until_ms = NULL
      WHERE event_id = ? AND projection_status = 'dead_letter'`).run(now, eventId).changes;
    const deliveries = db.prepare(`UPDATE automation_event_deliveries SET status = 'retrying', attempts = 0,
      next_attempt_at_ms = ?, last_error = NULL, lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ?
      WHERE event_id = ? AND status = 'dead_letter'`).run(now, now, eventId).changes;
    return Number(projection) + Number(deliveries) > 0;
  });
}

export function getAutomationEventQueueMetrics(): {
  pending: number;
  oldestPendingAgeMs: number;
  projectionDeadLetters: number;
  pendingDeliveries: number;
  deliveryDeadLetters: number;
  activeLeases: number;
} {
  const now = Date.now();
  const event = getSqliteDatabase().prepare(`SELECT
    SUM(CASE WHEN projection_status IN ('pending', 'projecting', 'retrying') THEN 1 ELSE 0 END) AS pending,
    MIN(CASE WHEN projection_status IN ('pending', 'projecting', 'retrying') THEN ingested_at_ms END) AS oldest,
    SUM(CASE WHEN projection_status = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letters
    FROM automation_events`).get() as { pending: number | null; oldest: number | null; dead_letters: number | null };
  const delivery = getSqliteDatabase().prepare(`SELECT
    SUM(CASE WHEN status IN ('pending', 'retrying', 'queued') THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letters,
    SUM(CASE WHEN lease_until_ms > ? THEN 1 ELSE 0 END) AS active_leases
    FROM automation_event_deliveries`).get(now) as {
      pending: number | null; dead_letters: number | null; active_leases: number | null;
    };
  const projectionLeases = getSqliteDatabase().prepare(`SELECT COUNT(*) AS count FROM automation_events
    WHERE projection_status = 'projecting' AND projection_lease_until_ms > ?`).get(now) as { count: number };
  return {
    pending: event.pending ?? 0,
    oldestPendingAgeMs: event.oldest == null ? 0 : Math.max(0, now - event.oldest),
    projectionDeadLetters: event.dead_letters ?? 0,
    pendingDeliveries: delivery.pending ?? 0,
    deliveryDeadLetters: delivery.dead_letters ?? 0,
    activeLeases: (delivery.active_leases ?? 0) + projectionLeases.count,
  };
}
