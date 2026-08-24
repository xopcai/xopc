import { KEYS, storage } from '../storage/mmkv';

export type UsageEventName =
  | 'home_viewed'
  | 'home_continue_opened'
  | 'home_focus_opened'
  | 'home_focus_action_completed'
  | 'home_focus_pinned'
  | 'capture_started'
  | 'capture_completed'
  | 'ask_ai_started'
  | 'notification_opened'
  | 'read_aloud_started'
  | 'read_aloud_completed'
  | 'read_aloud_stopped'
  | 'read_aloud_failed';

export type PerformanceEventName =
  | 'app_shell_rendered'
  | 'home_content_ready';

export type InteractionPerformanceEventName = 'read_aloud_first_audio';
export type TimedEventName = PerformanceEventName | InteractionPerformanceEventName;

export const mobileAppJsStartedAt = Date.now();

export type UsageEvent = {
  name: UsageEventName | TimedEventName;
  at: number;
  durationMs?: number;
};

const MAX_EVENTS = 200;
const recordedStartupMetrics = new Set<PerformanceEventName>();

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
      && typeof (item as UsageEvent).at === 'number'
      && ((item as UsageEvent).durationMs === undefined
        || typeof (item as UsageEvent).durationMs === 'number'),
    ));
  } catch {
    return [];
  }
}

export function recordUsageEvent(name: UsageEventName, at = Date.now()): void {
  const events = [...readEvents(), { name, at }].slice(-MAX_EVENTS);
  storage.set(KEYS.usageEvents, JSON.stringify(events));
}

export function recordPerformanceEvent(
  name: PerformanceEventName,
  durationMs: number,
  at = Date.now(),
): void {
  if (recordedStartupMetrics.has(name) || !Number.isFinite(durationMs) || durationMs < 0) return;
  recordedStartupMetrics.add(name);
  const events = [...readEvents(), { name, at, durationMs: Math.round(durationMs) }].slice(-MAX_EVENTS);
  storage.set(KEYS.usageEvents, JSON.stringify(events));
}

export function recordInteractionPerformanceEvent(
  name: InteractionPerformanceEventName,
  durationMs: number,
  at = Date.now(),
): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const events = [...readEvents(), { name, at, durationMs: Math.round(durationMs) }].slice(-MAX_EVENTS);
  storage.set(KEYS.usageEvents, JSON.stringify(events));
}

export function readPerformanceSummary(): Partial<Record<TimedEventName, {
  count: number;
  latestMs: number;
  averageMs: number;
}>> {
  const durations = new Map<TimedEventName, number[]>();
  for (const event of readEvents()) {
    if (event.durationMs === undefined) continue;
    const name = event.name as TimedEventName;
    durations.set(name, [...(durations.get(name) ?? []), event.durationMs]);
  }
  return Object.fromEntries([...durations].map(([name, values]) => [name, {
    count: values.length,
    latestMs: values.at(-1) ?? 0,
    averageMs: Math.round(values.reduce((total, value) => total + value, 0) / values.length),
  }]));
}

export function readUsageSummary(): Partial<Record<UsageEventName | TimedEventName, number>> {
  return readEvents().reduce<Partial<Record<UsageEventName | TimedEventName, number>>>((summary, event) => {
    summary[event.name] = (summary[event.name] ?? 0) + 1;
    return summary;
  }, {});
}

export function clearUsageEvents(): void {
  recordedStartupMetrics.clear();
  storage.delete(KEYS.usageEvents);
}
