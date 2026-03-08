import { createLogger } from '../../utils/logger.js';
import type { AgentContext } from '../service.js';
import type {
  LifecycleEventType,
  LifecycleEventData,
  LifecycleHandler,
} from './types.js';

const logger = createLogger('lifecycle-manager');

export class LifecycleManager {
  private handlers = new Map<LifecycleEventType, LifecycleHandler<unknown>[]>();

  on<T>(eventType: LifecycleEventType, handler: LifecycleHandler<T>): this {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler as LifecycleHandler<unknown>);
    this.handlers.set(eventType, existing);
    
    logger.debug({ eventType, handlerName: handler.name }, 'Registered lifecycle handler');
    return this;
  }

  async emit<T>(
    eventType: LifecycleEventType,
    sessionKey: string,
    payload: T,
    context: AgentContext
  ): Promise<void> {
    const handlers = this.handlers.get(eventType) || [];
    
    if (handlers.length === 0) {
      logger.debug({ eventType, sessionKey }, 'No handlers registered for event');
      return;
    }

    const event: LifecycleEventData<T> = {
      type: eventType,
      sessionKey,
      payload,
      timestamp: Date.now(),
    };

    logger.debug({ eventType, sessionKey, handlerCount: handlers.length }, 'Emitting lifecycle event');

    const results = await Promise.allSettled(
      handlers.map(async (handler) => {
        try {
          await handler.handle(event as LifecycleEventData<unknown>, context);
          logger.debug({ handler: handler.name, eventType }, 'Lifecycle handler completed');
        } catch (error) {
          logger.warn({ handler: handler.name, eventType, error }, 'Lifecycle handler failed');
          throw error;
        }
      })
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    if (failed > 0) {
      logger.warn({ eventType, succeeded, failed, total: handlers.length }, 'Some lifecycle handlers failed');
    } else {
      logger.debug({ eventType, succeeded, total: handlers.length }, 'All lifecycle handlers completed');
    }
  }

  getRegisteredHandlers(): Record<LifecycleEventType, string[]> {
    const result: Record<string, string[]> = {};
    for (const [eventType, handlers] of this.handlers.entries()) {
      result[eventType] = handlers.map((h) => h.name);
    }
    return result;
  }

  clear(): void {
    this.handlers.clear();
    logger.debug('All lifecycle handlers cleared');
  }
}
