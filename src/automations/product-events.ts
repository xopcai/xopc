import type { AutomationEvent } from './domain/types.js';

type AutomationProductEventListener = (event: AutomationEvent) => void | Promise<void>;

const AUTOMATION_PRODUCT_EVENT_LISTENERS = new Set<AutomationProductEventListener>();

export function onAutomationProductEvent(listener: AutomationProductEventListener): () => void {
  AUTOMATION_PRODUCT_EVENT_LISTENERS.add(listener);
  return () => {
    AUTOMATION_PRODUCT_EVENT_LISTENERS.delete(listener);
  };
}

export function publishAutomationProductEvent(event: AutomationEvent): void {
  const normalized: AutomationEvent = {
    ...event,
    occurredAtMs: event.occurredAtMs ?? Date.now(),
  };
  for (const listener of AUTOMATION_PRODUCT_EVENT_LISTENERS) {
    try {
      void listener(normalized);
    } catch {
      /* listeners isolate publisher paths */
    }
  }
}
