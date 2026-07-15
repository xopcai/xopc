const STORAGE_KEY = 'xopc:chat-welcome-suggestion-metrics:v1';
const EVENT_NAME = 'xopc:welcome-suggestion-metric';
const MAX_RECORDS = 64;

export type WelcomeSuggestionMetricType = 'impression' | 'pick' | 'send';

export type WelcomeSuggestionMetric = {
  type: WelcomeSuggestionMetricType;
  suggestionId: string;
  categoryId: string;
  contextKind: string;
  edited?: boolean;
  characterDelta?: number;
};

type MetricRecord = {
  impressions: number;
  picks: number;
  sends: number;
  lastUsedAt: number;
};

type MetricStore = Record<string, MetricRecord>;

function readStore(): MetricStore {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const store: MetricStore = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const record = value as Partial<MetricRecord>;
      store[id] = {
        impressions: Number.isFinite(record.impressions) ? Number(record.impressions) : 0,
        picks: Number.isFinite(record.picks) ? Number(record.picks) : 0,
        sends: Number.isFinite(record.sends) ? Number(record.sends) : 0,
        lastUsedAt: Number.isFinite(record.lastUsedAt) ? Number(record.lastUsedAt) : 0,
      };
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(store: MetricStore): void {
  try {
    const entries = Object.entries(store)
      .sort(([, a], [, b]) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, MAX_RECORDS);
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* local preference storage is best-effort */
  }
}

export function readWelcomeSuggestionAffinity(): Record<string, number> {
  const store = readStore();
  return Object.fromEntries(
    Object.entries(store).map(([id, record]) => [id, Math.min(35, record.picks * 4 + record.sends * 8)]),
  );
}

export function recordWelcomeSuggestionMetric(metric: WelcomeSuggestionMetric): void {
  const suggestionId = metric.suggestionId.trim();
  if (!suggestionId) return;
  const store = readStore();
  const current = store[suggestionId] ?? { impressions: 0, picks: 0, sends: 0, lastUsedAt: 0 };
  store[suggestionId] = {
    impressions: current.impressions + (metric.type === 'impression' ? 1 : 0),
    picks: current.picks + (metric.type === 'pick' ? 1 : 0),
    sends: current.sends + (metric.type === 'send' ? 1 : 0),
    lastUsedAt: Date.now(),
  };
  writeStore(store);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: metric }));
  }
}

export const WELCOME_SUGGESTION_METRIC_EVENT = EVENT_NAME;
