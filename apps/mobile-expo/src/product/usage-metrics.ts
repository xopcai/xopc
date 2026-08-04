import { KEYS, storage } from '../storage/mmkv';

export type UsageEventName =
  | 'home_viewed'
  | 'home_continue_opened'
  | 'home_decision_opened'
  | 'home_decision_completed'
  | 'capture_started'
  | 'capture_completed'
  | 'ask_ai_started'
  | 'notification_opened';

export type UsageEvent = {
  name: UsageEventName;
  at: number;
};

const MAX_EVENTS = 200;

function readEvents(): UsageEvent[] {
  const raw = storage.getString(KEYS.usageEvents);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is UsageEvent => Boolean(
      item
      && typeof item === 'object'
      && typeof (item as UsageEvent).name === 'string'
      && typeof (item as UsageEvent).at === 'number',
    ));
  } catch {
    return [];
  }
}

export function recordUsageEvent(name: UsageEventName, at = Date.now()): void {
  const events = [...readEvents(), { name, at }].slice(-MAX_EVENTS);
  storage.set(KEYS.usageEvents, JSON.stringify(events));
}

export function readUsageSummary(): Partial<Record<UsageEventName, number>> {
  return readEvents().reduce<Partial<Record<UsageEventName, number>>>((summary, event) => {
    summary[event.name] = (summary[event.name] ?? 0) + 1;
    return summary;
  }, {});
}

export function clearUsageEvents(): void {
  storage.delete(KEYS.usageEvents);
}
