import { randomUUID } from 'node:crypto';

import { runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { createLogger } from '../../utils/logger.js';
import type { AutomationEventEnvelope, AutomationRun } from '../domain/types.js';
import type { AutomationService } from '../service/automation-service.js';
import { getAutomation } from '../storage/index.js';
import {
  claimAutomationEventDeliveries,
  claimAutomationEventsForProjection,
  completeAutomationEventDelivery,
  completeAutomationEventProjection,
  deferAutomationEventDelivery,
  expireAutomationEventProjectionLeases,
  failAutomationEventProjection,
  markAutomationEventDeliveryQueued,
  reconcileAutomationEventDeliveries,
  releaseAutomationEventDelivery,
  releaseAutomationEventProjection,
  skipAutomationEventDelivery,
} from './event-repository.js';

const log = createLogger('AutomationEventDispatcher');
const DELIVERY_SCAN_BUDGET = 500;

export class AutomationEventDispatcher {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<number>;
  private stopping = false;
  private readonly owner = `automation-event:${process.pid}:${randomUUID()}`;
  private readonly abortController = new AbortController();

  constructor(private readonly automationService: AutomationService, private readonly options: {
    onEvent?: (event: AutomationEventEnvelope, signal?: AbortSignal) => void | Promise<void>;
    onDeadLetter?: (input: { phase: 'event_projection' | 'event_delivery'; eventId: string; automationId?: string; error: string }) => void;
    intervalMs?: number;
  } = {}) {}

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    reconcileAutomationEventDeliveries();
    void this.dispatch();
    this.timer = setInterval(() => void this.dispatch(), this.options.intervalMs ?? 1_000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.abortController.abort(new Error('Automation event dispatcher stopped'));
    await this.active?.catch(() => undefined);
  }

  dispatch(): Promise<number> {
    if (this.stopping) return Promise.resolve(0);
    this.active ??= this.runDispatch().finally(() => { this.active = undefined; });
    return this.active;
  }

  runCompleted(run: AutomationRun): void {
    completeAutomationEventDelivery(run.id, run.status);
    if (!this.stopping) void this.dispatch();
  }

  private async runDispatch(): Promise<number> {
    await this.projectEvents();
    const availableSlots = this.automationService.availableRunSlots();
    if (availableSlots <= 0 || this.stopping) return 0;
    let queued = 0;
    const deliveries = claimAutomationEventDeliveries(this.owner, DELIVERY_SCAN_BUDGET);
    for (const [index, delivery] of deliveries.entries()) {
      if (queued >= availableSlots || this.stopping) {
        for (const remaining of deliveries.slice(index)) {
          releaseAutomationEventDelivery(remaining.event.id, remaining.automationId, this.owner, 0);
        }
        break;
      }
      const automation = getAutomation(delivery.automationId);
      if (!automation || !automation.enabled) {
        skipAutomationEventDelivery(delivery.event.id, delivery.automationId, 'Automation is unavailable', this.owner);
        continue;
      }
      if (automation.state.runningRunId) {
        releaseAutomationEventDelivery(delivery.event.id, automation.id, this.owner);
        continue;
      }
      try {
        const run = runSqliteWriteTransaction(() => {
          const next = this.automationService.queueRunAtomically(automation.id, { manual: false, event: delivery.event });
          markAutomationEventDeliveryQueued(delivery.event.id, automation.id, next.id, this.owner);
          return next;
        });
        this.automationService.dispatchQueuedRun(run.id);
        queued += 1;
      } catch (error) {
        if (error instanceof Error && error.name === 'AutomationAlreadyRunningError') {
          releaseAutomationEventDelivery(delivery.event.id, automation.id, this.owner);
          continue;
        }
        const status = deferAutomationEventDelivery(delivery.event.id, automation.id, this.owner, error);
        if (status === 'dead_letter') this.options.onDeadLetter?.({
          phase: 'event_delivery', eventId: delivery.event.id, automationId: automation.id,
          error: error instanceof Error ? error.message : String(error),
        });
        log.warn({ err: error, eventId: delivery.event.id, automationId: automation.id, status },
          status === 'dead_letter'
            ? 'Automation event delivery moved to dead letter'
            : 'Automation event delivery will retry');
      }
    }
    return queued;
  }

  private async projectEvents(): Promise<void> {
    for (const expired of expireAutomationEventProjectionLeases()) {
      this.options.onDeadLetter?.({ phase: 'event_projection', ...expired });
      log.warn(expired, 'Automation event projection moved to dead letter after lease expiry');
    }
    for (const event of claimAutomationEventsForProjection(this.owner)) {
      if (this.stopping) {
        releaseAutomationEventProjection(event.id, this.owner);
        continue;
      }
      try {
        await this.options.onEvent?.(event, this.abortController.signal);
        completeAutomationEventProjection(event.id, this.owner);
      } catch (error) {
        if (this.stopping || this.abortController.signal.aborted) {
          releaseAutomationEventProjection(event.id, this.owner);
          continue;
        }
        const status = failAutomationEventProjection(event.id, this.owner, error);
        if (status === 'dead_letter') this.options.onDeadLetter?.({
          phase: 'event_projection', eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        });
        log.warn({ err: error, eventId: event.id, eventType: event.type, status },
          status === 'dead_letter'
            ? 'Automation event projection moved to dead letter'
            : 'Automation event projection will retry');
      }
    }
  }
}
