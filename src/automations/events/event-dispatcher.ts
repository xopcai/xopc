import { createLogger } from '../../utils/logger.js';
import { runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { getAutomation } from '../storage/index.js';
import type { AutomationEventEnvelope, AutomationRun } from '../domain/types.js';
import type { AutomationService } from '../service/automation-service.js';
import {
  completeAutomationEventDelivery,
  deferAutomationEventDelivery,
  listPendingAutomationEventDeliveries,
  listUnprojectedAutomationEvents,
  markAutomationEventDeliveryQueued,
  markAutomationEventProjected,
  recordAutomationEventProjectionFailure,
  reconcileAutomationEventDeliveries,
  skipAutomationEventDelivery,
} from './event-repository.js';

const log = createLogger('AutomationEventDispatcher');

export class AutomationEventDispatcher {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<number>;

  constructor(private readonly automationService: AutomationService, private readonly options: {
    onEvent?: (event: AutomationEventEnvelope) => void | Promise<void>;
    intervalMs?: number;
  } = {}) {}

  start(): void {
    if (this.timer) return;
    reconcileAutomationEventDeliveries();
    void this.dispatch();
    this.timer = setInterval(() => void this.dispatch(), this.options.intervalMs ?? 1_000);
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

  runCompleted(run: AutomationRun): void {
    completeAutomationEventDelivery(run.id, run.status);
    void this.dispatch();
  }

  private async runDispatch(): Promise<number> {
    await this.projectEvents();
    let queued = 0;
    const availableSlots = this.automationService.availableRunSlots();
    for (const delivery of listPendingAutomationEventDeliveries(100)) {
      if (queued >= availableSlots) break;
      const automation = getAutomation(delivery.automationId);
      if (!automation || !automation.enabled) {
        skipAutomationEventDelivery(delivery.event.id, delivery.automationId, 'Automation is unavailable');
        continue;
      }
      if (automation.state.runningRunId) continue;
      try {
        const run = runSqliteWriteTransaction(() => {
          const queued = this.automationService.queueRunAtomically(automation.id, { manual: false, event: delivery.event });
          markAutomationEventDeliveryQueued(delivery.event.id, automation.id, queued.id);
          return queued;
        });
        this.automationService.dispatchQueuedRun(run.id);
        queued += 1;
      } catch (error) {
        deferAutomationEventDelivery(delivery.event.id, automation.id, error);
      }
    }
    return queued;
  }

  private async projectEvents(): Promise<void> {
    for (const event of listUnprojectedAutomationEvents()) {
      try {
        await this.options.onEvent?.(event);
        markAutomationEventProjected(event.id);
      } catch (error) {
        recordAutomationEventProjectionFailure(event.id, error);
        log.warn({ err: error, eventId: event.id, eventType: event.type }, 'Automation event projection failed');
        break;
      }
    }
  }

}
