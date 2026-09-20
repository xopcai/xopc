import type { DatabaseSync } from 'node:sqlite';

export interface NotificationDispatch {
  id: string;
  notificationId: string;
  ownerId: string;
  workspaceId: string;
  channel: 'browser' | 'telegram';
  destinationId: string;
  destination: unknown;
  subjectId: string | null;
  subjectRevision: number;
  attempt: number;
}
export type DispatchPolicy = { action: 'send' } | { action: 'cancel' } | { action: 'defer'; until: number };
export type DispatchReceipt = { status: 'accepted'; providerMessageId: string | null }
  | { status: 'rejected'; retryAt?: number };

/** Owns durable delivery only. The host supplies policy and transports; neither may widen the saved scope. */
export class NotificationDispatcher {
  private active: { controller: AbortController; work: Promise<boolean> } | null = null;
  private stopped = false;

  constructor(private readonly db: DatabaseSync, private readonly dependencies: {
    authorize: (dispatch: NotificationDispatch, signal: AbortSignal) => Promise<DispatchPolicy>;
    send: (dispatch: NotificationDispatch, signal: AbortSignal) => Promise<DispatchReceipt>;
    clock?: () => number;
    timeoutMs?: number;
  }) {
    const timeout = dependencies.timeoutMs ?? 15_000;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60_000) throw new Error('Invalid dispatch timeout');
  }

  /** Called by the host notification pump; overlapping passes never make a second claim. */
  drainOne(): Promise<boolean> {
    if (this.stopped || this.active) return Promise.resolve(false);
    const controller = new AbortController();
    const work = Promise.resolve().then(() => this.deliver(controller)).finally(() => { this.active = null; });
    this.active = { controller, work };
    return work;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const active = this.active;
    active?.controller.abort();
    await active?.work;
  }

  private now(): number { return (this.dependencies.clock ?? Date.now)(); }

  private async deliver(controller: AbortController): Promise<boolean> {
    if (controller.signal.aborted) return false;
    const now = this.now();
    // A crashed sender may already have reached the provider. Never reclaim it for sending.
    this.db.prepare(`UPDATE notification_dispatches SET status = 'unknown', lease_until = NULL, last_error = 'lease_expired'
      WHERE status = 'sending' AND (lease_until IS NULL OR lease_until <= ?)`).run(now);
    const row = this.db.prepare(`UPDATE notification_dispatches SET status = 'sending', attempt = attempt + 1, lease_until = ?
      WHERE id = (SELECT id FROM notification_dispatches WHERE status = 'pending' AND next_attempt_at <= ?
        ORDER BY next_attempt_at, id LIMIT 1) AND status = 'pending' RETURNING *`)
      .get(now + (this.dependencies.timeoutMs ?? 15_000) + 1000, now);
    if (!row) return false;
    const id = String(row.id);
    const attempt = Number(row.attempt);
    const failures = Number(row.failure_count);
    const finish = (status: string, reason: string | null, retryAt = this.now(), receipt: string | null = null, failed = false) =>
      this.db.prepare(`UPDATE notification_dispatches SET status = ?, last_error = ?, next_attempt_at = ?,
        provider_message_id = ?, failure_count = failure_count + ?, lease_until = NULL
        WHERE id = ? AND attempt = ? AND status = 'sending' AND lease_until > ?`)
        .run(status, reason, retryAt, receipt, failed ? 1 : 0, id, attempt, this.now());
    let sending = false;
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => { onAbort = () => reject(new Error('Dispatch cancelled')); });
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.dependencies.timeoutMs ?? 15_000);
    try {
      const dispatch: NotificationDispatch = { id, notificationId: String(row.notification_id), ownerId: String(row.owner_id),
        workspaceId: String(row.workspace_id), channel: row.channel as NotificationDispatch['channel'],
        destinationId: String(row.destination_id), destination: row.destination_json === null ? null : JSON.parse(String(row.destination_json)),
        subjectId: row.subject_id === null ? null : String(row.subject_id), subjectRevision: Number(row.subject_revision), attempt };
      const policy = await Promise.race([this.dependencies.authorize(dispatch, controller.signal), cancelled]);
      if (controller.signal.aborted) throw new Error('Dispatch cancelled');
      if (policy.action === 'cancel') { finish('cancelled', 'policy_cancelled'); return true; }
      if (policy.action === 'defer') {
        if (!Number.isSafeInteger(policy.until) || policy.until <= this.now()) throw new Error('Invalid notification deferral');
        finish('pending', 'policy_deferred', policy.until); return true;
      }
      if (policy.action !== 'send') throw new Error('Invalid dispatch policy');
      // Check the lease again after async policy evaluation and immediately before the external call.
      const held = this.db.prepare("SELECT 1 FROM notification_dispatches WHERE id = ? AND attempt = ? AND status = 'sending' AND lease_until > ?")
        .get(id, attempt, this.now());
      if (!held) return true;
      sending = true;
      const receipt = await Promise.race([this.dependencies.send(dispatch, controller.signal), cancelled]);
      if (controller.signal.aborted) throw new Error('Dispatch cancelled');
      if (receipt.status === 'accepted') {
        if (dispatch.channel === 'telegram' && !receipt.providerMessageId?.trim()) { finish('unknown', 'missing_provider_receipt'); return true; }
        finish('accepted', null, this.now(), receipt.providerMessageId);
      } else if (receipt.status === 'rejected') {
        const retryAt = receipt.retryAt;
        if (retryAt !== undefined && (!Number.isSafeInteger(retryAt) || retryAt <= this.now())) { finish('failed', 'invalid_retry_time'); return true; }
        finish(retryAt !== undefined && failures + 1 < 5 ? 'pending' : 'failed', 'provider_rejected', retryAt ?? this.now(), null, true);
      } else finish('unknown', 'invalid_provider_receipt');
    } catch {
      // Policy errors are known not to have sent. Transport errors are ambiguous, regardless of retry count.
      finish(sending ? 'unknown' : failures + 1 < 5 ? 'pending' : 'failed', sending ? 'transport_unconfirmed' : 'policy_unavailable', this.now() + 30_000, null, true);
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort);
    }
    return true;
  }
}
