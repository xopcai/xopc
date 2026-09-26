import { createLogger } from '../../utils/logger.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import type { Automation, AutomationResultDeliveryRecord, AutomationRun } from '../domain/types.js';
import { getAutomationRun } from '../storage/index.js';

const log = createLogger('AutomationDeliveryRouter');
const MAX_ATTEMPTS = 5;

type DeliveryRow = {
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

type AutomationDeliveryKind = string;
type AutomationDeliveryHandler = (input: {
  run: AutomationRun;
  result: AutomationResultEnvelope;
  config: Record<string, unknown>;
}) => void | Promise<void>;

export interface AutomationResultEnvelope {
  runId: string;
  automationId: string;
  automationName: string;
  status: AutomationRun['status'];
  summary?: string;
  error?: string;
  conversationId?: string;
  workflowRunId?: string;
  createdAtMs: number;
  completedAtMs: number;
}

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
  const rows = getSqliteDatabase().prepare(`SELECT run_id, destination_key, kind, status, config_json,
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

function toResult(run: AutomationRun): AutomationResultEnvelope {
  if (run.endedAtMs === undefined) throw new Error('Cannot deliver an unfinished automation run');
  return {
    runId: run.id,
    automationId: run.automationId,
    automationName: run.automationName,
    status: run.status,
    summary: run.summary,
    error: run.error,
    conversationId: run.conversationId,
    workflowRunId: run.workflowRunId,
    createdAtMs: run.createdAtMs,
    completedAtMs: run.endedAtMs,
  };
}

export class AutomationDeliveryRouter {
  private active?: Promise<number>;
  private timer?: ReturnType<typeof setInterval>;
  private readonly handlers = new Map<AutomationDeliveryKind, AutomationDeliveryHandler>();

  constructor(private readonly options: {
    deliverGatewayEvent?: (run: AutomationRun) => void | Promise<void>;
    fetch?: typeof fetch;
  } = {}) {
    this.register('gateway_event', ({ run }) => this.options.deliverGatewayEvent?.(run));
    this.register('webhook', ({ config, result }) => this.postWebhook(String(config.url), result));
  }

  register(kind: AutomationDeliveryKind, handler: AutomationDeliveryHandler): void {
    if (this.handlers.has(kind)) throw new Error(`Automation delivery handler already registered: ${kind}`);
    this.handlers.set(kind, handler);
  }

  enqueue(run: AutomationRun, automation: Automation): void {
    const now = Date.now();
    const insert = getSqliteDatabase().prepare(`INSERT OR IGNORE INTO automation_result_deliveries (
      run_id, destination_key, kind, status, config_json, attempts, next_attempt_at_ms, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, 'pending', ?, 0, ?, ?, ?)`);
    insert.run(run.id, 'gateway_event', 'gateway_event', JSON.stringify({}), now, now, now);
    if ((automation.safety?.mode ?? 'auto_apply') === 'auto_apply' && automation.delivery.completionWebhookUrl) {
      insert.run(run.id, 'completion_webhook', 'webhook', JSON.stringify({ url: automation.delivery.completionWebhookUrl }), now, now, now);
    }
  }

  start(): void {
    if (this.timer) return;
    getSqliteDatabase().prepare(`UPDATE automation_result_deliveries
      SET status = 'failed', next_attempt_at_ms = ?, last_error = 'Delivery interrupted by restart', updated_at_ms = ?
      WHERE status = 'delivering'`).run(Date.now(), Date.now());
    void this.dispatch();
    this.timer = setInterval(() => void this.dispatch(), 1_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  dispatch(): Promise<number> {
    this.active ??= this.runDispatch().finally(() => { this.active = undefined; });
    return this.active;
  }

  private async runDispatch(): Promise<number> {
    const rows = getSqliteDatabase().prepare(`SELECT run_id, destination_key, kind, config_json, attempts
      FROM automation_result_deliveries
      WHERE status IN ('pending', 'failed') AND attempts < ? AND next_attempt_at_ms <= ?
      ORDER BY created_at_ms, run_id LIMIT 100`).all(MAX_ATTEMPTS, Date.now()) as DeliveryRow[];
    let delivered = 0;
    for (const row of rows) {
      const claimed = getSqliteDatabase().prepare(`UPDATE automation_result_deliveries
        SET status = 'delivering', attempts = attempts + 1, updated_at_ms = ?
        WHERE run_id = ? AND destination_key = ? AND status IN ('pending', 'failed') AND attempts = ?`)
        .run(Date.now(), row.run_id, row.destination_key, row.attempts).changes;
      if (claimed !== 1) continue;
      const run = getAutomationRun(row.run_id);
      if (!run) {
        getSqliteDatabase().prepare(`UPDATE automation_result_deliveries
          SET status = 'failed', last_error = 'Automation run is unavailable', updated_at_ms = ?
          WHERE run_id = ? AND destination_key = ?`).run(Date.now(), row.run_id, row.destination_key);
        continue;
      }
      try {
        const handler = this.handlers.get(row.kind);
        if (!handler) throw new Error(`Automation delivery handler is unavailable: ${row.kind}`);
        await handler({ run, result: toResult(run), config: JSON.parse(row.config_json) as Record<string, unknown> });
        getSqliteDatabase().prepare(`UPDATE automation_result_deliveries
          SET status = 'delivered', last_error = NULL, updated_at_ms = ?
          WHERE run_id = ? AND destination_key = ?`).run(Date.now(), row.run_id, row.destination_key);
        delivered += 1;
      } catch (error) {
        const delayMs = Math.min(60_000, 1_000 * 2 ** row.attempts);
        getSqliteDatabase().prepare(`UPDATE automation_result_deliveries
          SET status = 'failed', next_attempt_at_ms = ?, last_error = ?, updated_at_ms = ?
          WHERE run_id = ? AND destination_key = ?`).run(
          Date.now() + delayMs,
          error instanceof Error ? error.message : String(error),
          Date.now(), row.run_id, row.destination_key,
        );
        log.warn({ err: error, runId: row.run_id, deliveryKind: row.kind }, 'Automation result delivery failed');
      }
    }
    return delivered;
  }

  private async postWebhook(url: string, result: AutomationResultEnvelope): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Automation delivery timed out')), 30_000);
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result), signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Automation delivery failed with HTTP ${response.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
