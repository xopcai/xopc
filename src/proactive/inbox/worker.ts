import { reconcileCards } from './lifecycle.js';
import { createLogger } from '../../utils/logger.js';
import { executePendingProactiveActions } from '../actions/service.js';
import { pruneProactiveHistory } from '../maintenance.js';
import { claimDelivery, deferDelivery, finishDelivery, projectInsightsToInbox, recoverExpiredDeliveries, wakeSnoozedItems } from './repository.js';
import type { InboxDeliveryAdapter } from './types.js';

const log = createLogger('ProactiveInboxWorker');

export class ProactiveInboxWorker {
  private timer?: NodeJS.Timeout;
  private running = false;
  private waiters: Array<() => void> = [];
  private lastMaintenanceAt = 0;

  constructor(private readonly delivery: InboxDeliveryAdapter, private readonly intervalMs = 3_000) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref(); void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer); this.timer = undefined;
    if (this.running) await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      if (now - this.lastMaintenanceAt >= 60 * 60_000) {
        pruneProactiveHistory(new Date(now));
        this.lastMaintenanceAt = now;
      }
      projectInsightsToInbox(); reconcileCards(); executePendingProactiveActions(); wakeSnoozedItems(); recoverExpiredDeliveries();
      const claim = claimDelivery();
      if (!claim) return;
      try {
        const result = await this.delivery.deliver({ deliveryId: claim.id, inboxItem: claim.item });
        if (result && result.retryAt) { deferDelivery(claim.id, claim.attempt, result.retryAt); return; }
        finishDelivery(claim.id, undefined, claim.attempt);
      } catch (error) {
        finishDelivery(claim.id, error, claim.attempt);
        log.warn({ err: error, deliveryId: claim.id, inboxItemId: claim.item.id }, 'Proactive inbox delivery failed');
      }
    } finally { this.running = false; for (const resolve of this.waiters.splice(0)) resolve(); }
  }
}
