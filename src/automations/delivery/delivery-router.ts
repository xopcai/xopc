import { createHmac, randomUUID } from 'node:crypto';

import { assertUrlSafe } from '../../agent/tools/url-safety.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { createLogger } from '../../utils/logger.js';
import type {
  Automation,
  AutomationArtifact,
  AutomationResultDeliveryRecord,
  AutomationResultEnvelope,
  AutomationRun,
  AutomationRunDeliveryContext,
} from '../domain/types.js';
import { getAutomationEventForRun } from '../events/index.js';
import { getAutomationRun } from '../storage/index.js';
import { resolveAutomationWebhookSecret } from '../webhook-secrets.js';

const log = createLogger('AutomationDeliveryRouter');
const MAX_ATTEMPTS = 5;
const LEASE_MS = 45_000;
const MAX_INLINE_ARTIFACT_BYTES = 64 * 1024;

type DeliveryRow = {
  delivery_id: string;
  run_id: string;
  destination_key: string;
  kind: string;
  config_json: string;
  attempts: number;
};

type DeliveryRecordRow = DeliveryRow & {
  status: AutomationResultDeliveryRecord['status'];
  next_attempt_at_ms: number;
  last_error: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

type ExpiredDelivery = {
  runId: string;
  destinationKey: string;
  error: string;
};

type AutomationDeliveryHandler = (input: {
  deliveryId: string;
  attempt: number;
  run: AutomationRun;
  result: AutomationResultEnvelope;
  config: Record<string, unknown>;
  signal: AbortSignal;
}) => void | Promise<void>;

export function listAutomationResultDeliveries(input: {
  runId?: string;
  status?: AutomationResultDeliveryRecord['status'];
  limit?: number;
} = {}): AutomationResultDeliveryRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (input.runId) { clauses.push('run_id = ?'); params.push(input.runId); }
  if (input.status) { clauses.push('status = ?'); params.push(input.status); }
  params.push(Math.max(1, Math.min(200, Math.floor(input.limit ?? 50))));
  const rows = getSqliteDatabase().prepare(`SELECT delivery_id, run_id, destination_key, kind, status, config_json,
    attempts, next_attempt_at_ms, last_error, created_at_ms, updated_at_ms
    FROM automation_result_deliveries ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY created_at_ms DESC, run_id DESC, destination_key LIMIT ?`).all(...params) as DeliveryRecordRow[];
  return rows.map(row => ({
    runId: row.run_id,
    destinationKey: row.destination_key,
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAtMs: row.next_attempt_at_ms,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  }));
}

export function retryAutomationResultDelivery(runId: string, destinationKey: string): boolean {
  const now = Date.now();
  return getSqliteDatabase().prepare(`UPDATE automation_result_deliveries
    SET status = 'retrying', attempts = 0, next_attempt_at_ms = ?, last_error = NULL,
        lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ?
    WHERE run_id = ? AND destination_key = ? AND status = 'dead_letter'`)
    .run(now, now, runId, destinationKey).changes === 1;
}

export function getAutomationResultDeliveryMetrics(): {
  pending: number;
  deadLetters: number;
  activeLeases: number;
} {
  const now = Date.now();
  const row = getSqliteDatabase().prepare(`SELECT
    SUM(CASE WHEN status IN ('pending', 'retrying', 'delivering') THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letters,
    SUM(CASE WHEN status = 'delivering' AND lease_until_ms > ? THEN 1 ELSE 0 END) AS active_leases
    FROM automation_result_deliveries`).get(now) as {
      pending: number | null;
      dead_letters: number | null;
      active_leases: number | null;
    };
  return { pending: row.pending ?? 0, deadLetters: row.dead_letters ?? 0, activeLeases: row.active_leases ?? 0 };
}

function assertArtifacts(artifacts: AutomationArtifact[]): void {
  for (const artifact of artifacts) {
    if (artifact.kind === 'file') {
      let uri: URL;
      try { uri = new URL(artifact.uri); }
      catch { throw new Error(`Automation file artifact must use an authorized URI: ${artifact.id}`); }
      if (uri.protocol !== 'xopc:' && uri.protocol !== 'https:') {
        throw new Error(`Automation file artifact URI is not allowed: ${artifact.id}`);
      }
      continue;
    }
    if (artifact.kind === 'reference') continue;
    if (Buffer.byteLength(JSON.stringify(artifact)) > MAX_INLINE_ARTIFACT_BYTES) {
      throw new Error(`Automation artifact exceeds ${MAX_INLINE_ARTIFACT_BYTES} bytes: ${artifact.id}`);
    }
  }
}

function toResult(run: AutomationRun, artifacts: AutomationArtifact[]): AutomationResultEnvelope {
  if (run.endedAtMs === undefined || !['succeeded', 'failed', 'cancelled', 'timeout'].includes(run.status)) {
    throw new Error('Cannot deliver an unfinished automation run');
  }
  assertArtifacts(artifacts);
  const event = getAutomationEventForRun(run.id);
  return {
    schemaVersion: 1,
    resultId: `result:${run.id}`,
    runId: run.id,
    automationId: run.automationId,
    status: run.status as AutomationResultEnvelope['status'],
    ...(run.summary ? { summary: run.summary } : {}),
    ...(run.error ? { error: { code: `AUTOMATION_${run.status.toUpperCase()}`, message: run.error, retryable: false } } : {}),
    artifacts,
    correlationId: event?.correlationId ?? run.id,
    rootEventId: event?.rootEventId ?? run.id,
    createdAtMs: run.createdAtMs,
    completedAtMs: run.endedAtMs,
  };
}

export class AutomationDeliveryRouter {
  private active?: Promise<number>;
  private timer?: ReturnType<typeof setInterval>;
  private readonly handlers = new Map<string, AutomationDeliveryHandler>();
  private readonly owner = `automation-delivery:${process.pid}:${randomUUID()}`;
  private readonly abortController = new AbortController();

  constructor(private readonly options: {
    deliverGatewayEvent?: (run: AutomationRun, context: AutomationRunDeliveryContext) => void | Promise<void>;
    onDeadLetter?: (input: { phase: 'result_delivery'; runId: string; destinationKey: string; error: string }) => void;
    fetch?: typeof fetch;
  } = {}) {
    this.register('gateway_event', ({ run, config }) => this.options.deliverGatewayEvent?.(run, {
      notificationPolicy: config.notificationPolicy as AutomationRunDeliveryContext['notificationPolicy'],
      requiresAttention: config.requiresAttention === true,
      ...(typeof config.projectId === 'string' ? { projectId: config.projectId } : {}),
    }));
    this.register('webhook', input => this.postWebhook(input));
  }

  register(kind: string, handler: AutomationDeliveryHandler): void {
    if (this.handlers.has(kind)) throw new Error(`Automation delivery handler already registered: ${kind}`);
    this.handlers.set(kind, handler);
  }

  validateArtifacts(artifacts: AutomationArtifact[]): void {
    assertArtifacts(artifacts);
  }

  enqueue(run: AutomationRun, automation: Automation, suppliedArtifacts: AutomationArtifact[] = []): void {
    const now = Date.now();
    const artifacts = suppliedArtifacts.length > 0
      ? suppliedArtifacts
      : run.summary
        ? [{ id: `summary:${run.id}`, kind: 'text' as const, text: run.summary, mediaType: 'text/plain' as const }]
        : [];
    const result = toResult(run, artifacts);
    runSqliteWriteTransaction((db) => {
      db.prepare(`INSERT INTO automation_results (run_id, result_id, result_json, created_at_ms)
        VALUES (?, ?, ?, ?)`).run(run.id, result.resultId, JSON.stringify(result), now);
      const insert = db.prepare(`INSERT INTO automation_result_deliveries (
        delivery_id, run_id, destination_key, kind, status, config_json, attempts,
        next_attempt_at_ms, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?)`);
      for (const destination of automation.delivery.destinations) {
        const config = destination.kind === 'gateway_event'
          ? {
              ...destination,
              notificationPolicy: automation.delivery.notificationPolicy,
              requiresAttention: run.status !== 'succeeded'
                || (automation.safety?.mode ?? 'auto_apply') !== 'auto_apply',
              ...(automation.projectId ? { projectId: automation.projectId } : {}),
            }
          : destination;
        insert.run(randomUUID(), run.id, destination.key, destination.kind, JSON.stringify(config), now, now, now);
      }
    });
  }

  start(): void {
    if (this.timer) return;
    void this.dispatch();
    this.timer = setInterval(() => void this.dispatch(), 1_000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.abortController.abort(new Error('Automation delivery router stopped'));
    await this.active?.catch(() => undefined);
  }

  dispatch(): Promise<number> {
    this.active ??= this.runDispatch().finally(() => { this.active = undefined; });
    return this.active;
  }

  private claim(limit: number): { rows: DeliveryRow[]; expired: ExpiredDelivery[] } {
    const now = Date.now();
    return runSqliteWriteTransaction((db) => {
      const expiredCandidates = db.prepare(`SELECT delivery_id, run_id, destination_key
        FROM automation_result_deliveries
        WHERE status = 'delivering' AND lease_until_ms <= ? AND attempts >= ?`)
        .all(now, MAX_ATTEMPTS) as Array<{ delivery_id: string; run_id: string; destination_key: string }>;
      const expire = db.prepare(`UPDATE automation_result_deliveries
        SET status = 'dead_letter', last_error = 'Delivery lease expired after maximum attempts',
            lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ?
        WHERE delivery_id = ? AND status = 'delivering' AND lease_until_ms <= ? AND attempts >= ?`);
      const expired: ExpiredDelivery[] = [];
      for (const candidate of expiredCandidates) {
        if (expire.run(now, candidate.delivery_id, now, MAX_ATTEMPTS).changes === 1) {
          expired.push({
            runId: candidate.run_id,
            destinationKey: candidate.destination_key,
            error: 'Delivery lease expired after maximum attempts',
          });
        }
      }
      const candidates = db.prepare(`SELECT delivery_id, run_id, destination_key, kind, config_json, attempts
        FROM automation_result_deliveries
        WHERE attempts < ? AND (
          (status IN ('pending', 'retrying') AND next_attempt_at_ms <= ?)
          OR (status = 'delivering' AND lease_until_ms <= ?)
        )
        ORDER BY created_at_ms, run_id, destination_key LIMIT ?`)
        .all(MAX_ATTEMPTS, now, now, limit) as DeliveryRow[];
      const claimed: DeliveryRow[] = [];
      const statement = db.prepare(`UPDATE automation_result_deliveries
        SET status = 'delivering', attempts = attempts + 1, lease_owner = ?, lease_until_ms = ?, updated_at_ms = ?
        WHERE delivery_id = ? AND attempts = ? AND (
          (status IN ('pending', 'retrying') AND next_attempt_at_ms <= ?)
          OR (status = 'delivering' AND lease_until_ms <= ?)
        )`);
      for (const candidate of candidates) {
        if (statement.run(this.owner, now + LEASE_MS, now, candidate.delivery_id, candidate.attempts, now, now).changes === 1) {
          claimed.push(candidate);
        }
      }
      return { rows: claimed, expired };
    });
  }

  private async runDispatch(): Promise<number> {
    const { rows, expired } = this.claim(100);
    for (const item of expired) {
      this.options.onDeadLetter?.({ phase: 'result_delivery', ...item });
      log.warn(item, 'Automation result delivery moved to dead letter after lease expiry');
    }
    let delivered = 0;
    for (const [index, row] of rows.entries()) {
      if (this.abortController.signal.aborted) {
        for (const remaining of rows.slice(index)) this.release(remaining);
        break;
      }
      const run = getAutomationRun(row.run_id);
      const resultRow = getSqliteDatabase().prepare('SELECT result_json FROM automation_results WHERE run_id = ?')
        .get(row.run_id) as { result_json: string } | undefined;
      if (!run || !resultRow) {
        this.fail(row, new Error('Automation result is unavailable'), true);
        continue;
      }
      try {
        const handler = this.handlers.get(row.kind);
        if (!handler) throw new Error(`Automation delivery handler is unavailable: ${row.kind}`);
        await handler({
          deliveryId: row.delivery_id,
          attempt: row.attempts + 1,
          run,
          result: JSON.parse(resultRow.result_json) as AutomationResultEnvelope,
          config: JSON.parse(row.config_json) as Record<string, unknown>,
          signal: this.abortController.signal,
        });
        const changed = getSqliteDatabase().prepare(`UPDATE automation_result_deliveries
          SET status = 'delivered', last_error = NULL, lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ?
          WHERE delivery_id = ? AND status = 'delivering' AND lease_owner = ?`)
          .run(Date.now(), row.delivery_id, this.owner).changes;
        if (changed === 1) delivered += 1;
      } catch (error) {
        if (this.abortController.signal.aborted) this.release(row);
        else this.fail(row, error, false);
      }
    }
    return delivered;
  }

  private release(row: DeliveryRow): void {
    getSqliteDatabase().prepare(`UPDATE automation_result_deliveries
      SET status = 'retrying', attempts = MAX(0, attempts - 1), next_attempt_at_ms = ?,
          lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ?
      WHERE delivery_id = ? AND status = 'delivering' AND lease_owner = ?`)
      .run(Date.now(), Date.now(), row.delivery_id, this.owner);
  }

  private fail(row: DeliveryRow, error: unknown, permanent: boolean): void {
    const attempts = row.attempts + 1;
    const terminal = permanent || attempts >= MAX_ATTEMPTS;
    const delayMs = Math.min(10 * 60_000, 1_000 * 5 ** Math.max(0, attempts - 1));
    const changed = getSqliteDatabase().prepare(`UPDATE automation_result_deliveries
      SET status = ?, next_attempt_at_ms = ?, last_error = ?, lease_owner = NULL,
          lease_until_ms = NULL, updated_at_ms = ?
      WHERE delivery_id = ? AND status = 'delivering' AND lease_owner = ?`).run(
      terminal ? 'dead_letter' : 'retrying',
      Date.now() + delayMs,
      error instanceof Error ? error.message : String(error),
      Date.now(),
      row.delivery_id,
      this.owner,
    ).changes;
    if (changed !== 1) return;
    if (terminal) this.options.onDeadLetter?.({
      phase: 'result_delivery', runId: row.run_id, destinationKey: row.destination_key,
      error: error instanceof Error ? error.message : String(error),
    });
    log.warn({ err: error, runId: row.run_id, deliveryKind: row.kind, attempt: attempts },
      terminal ? 'Automation result delivery moved to dead letter' : 'Automation result delivery will retry');
  }

  private async postWebhook(input: {
    deliveryId: string;
    attempt: number;
    result: AutomationResultEnvelope;
    config: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<void> {
    const endpoint = String(input.config.endpoint ?? '');
    const secretId = String(input.config.secretId ?? '');
    assertUrlSafe(endpoint);
    const secret = resolveAutomationWebhookSecret(secretId);
    if (!secret) throw new Error(`Automation webhook secret is unavailable: ${secretId}`);
    const timestamp = String(Date.now());
    const body = JSON.stringify(input.result);
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const controller = new AbortController();
    const onAbort = () => controller.abort(input.signal.reason);
    input.signal.addEventListener('abort', onAbort, { once: true });
    if (input.signal.aborted) onAbort();
    const timer = setTimeout(() => controller.abort(new Error('Automation delivery timed out')), 30_000);
    try {
      const response = await (this.options.fetch ?? fetch)(endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `${input.result.runId}:${String(input.config.key)}`,
          'x-xopc-delivery-id': input.deliveryId,
          'x-xopc-delivery-attempt': String(input.attempt),
          'x-xopc-timestamp': timestamp,
          'x-xopc-signature': `sha256=${signature}`,
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Automation delivery failed with HTTP ${response.status}`);
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener('abort', onAbort);
    }
  }
}
