export type StreamingRenderMetricsSnapshot = {
  key: string;
  deltaCount: number;
  commitCount: number;
  averageCommitIntervalMs: number;
  parseCount: number;
  averageParseMs: number;
  latestParseMs: number;
  longestParseMs: number;
  stableBlockCount: number;
  tailLength: number;
  latestContentLength: number;
  layoutShiftScore: number;
  longTaskCount: number;
  longestTaskMs: number;
  active: boolean;
};

type MutableStreamingRenderMetrics = {
  key: string;
  deltaCount: number;
  commitCount: number;
  firstCommitAt?: number;
  lastCommitAt?: number;
  parseCount: number;
  totalParseMs: number;
  latestParseMs: number;
  longestParseMs: number;
  stableBlockCount: number;
  tailLength: number;
  latestContentLength: number;
  layoutShiftScore: number;
  longTaskCount: number;
  longestTaskMs: number;
  active: boolean;
};

const MAX_TRACKED_STREAMS = 40;
const metrics = new Map<string, MutableStreamingRenderMetrics>();
const activeKeys = new Set<string>();
let performanceObserversStarted = false;

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function metricFor(key: string): MutableStreamingRenderMetrics | null {
  if (!import.meta.env.DEV || !key) return null;
  const existing = metrics.get(key);
  if (existing) return existing;
  if (metrics.size >= MAX_TRACKED_STREAMS) {
    const oldestKey = metrics.keys().next().value;
    if (oldestKey) {
      metrics.delete(oldestKey);
      activeKeys.delete(oldestKey);
    }
  }
  const created: MutableStreamingRenderMetrics = {
    key,
    deltaCount: 0,
    commitCount: 0,
    parseCount: 0,
    totalParseMs: 0,
    latestParseMs: 0,
    longestParseMs: 0,
    stableBlockCount: 0,
    tailLength: 0,
    latestContentLength: 0,
    layoutShiftScore: 0,
    longTaskCount: 0,
    longestTaskMs: 0,
    active: false,
  };
  metrics.set(key, created);
  return created;
}

function updateActiveMetrics(update: (metric: MutableStreamingRenderMetrics) => void): void {
  for (const key of activeKeys) {
    const metric = metrics.get(key);
    if (metric) update(metric);
  }
}

function startPerformanceObservers(): void {
  if (
    performanceObserversStarted ||
    !import.meta.env.DEV ||
    typeof PerformanceObserver === 'undefined'
  ) {
    return;
  }
  performanceObserversStarted = true;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value?: number;
          hadRecentInput?: boolean;
        };
        if (shift.hadRecentInput || !Number.isFinite(shift.value)) continue;
        updateActiveMetrics((metric) => {
          metric.layoutShiftScore += shift.value ?? 0;
        });
      }
    }).observe({ type: 'layout-shift' });
  } catch {
    // The browser does not expose layout-shift entries.
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        updateActiveMetrics((metric) => {
          metric.longTaskCount += 1;
          metric.longestTaskMs = Math.max(metric.longestTaskMs, entry.duration);
        });
      }
    }).observe({ type: 'longtask' });
  } catch {
    // The browser does not expose longtask entries.
  }
}

export function startStreamingRenderMetrics(key: string): void {
  const metric = metricFor(key);
  if (!metric) return;
  metric.active = true;
  activeKeys.add(key);
  startPerformanceObservers();
}

export function finishStreamingRenderMetrics(key: string): void {
  const metric = metrics.get(key);
  if (!metric) return;
  metric.active = false;
  activeKeys.delete(key);
}

export function recordStreamingDelta(key: string, contentLength: number): void {
  const metric = metricFor(key);
  if (!metric) return;
  metric.deltaCount += 1;
  metric.latestContentLength = contentLength;
}

export function recordStreamingCommit(key: string, contentLength: number): void {
  const metric = metricFor(key);
  if (!metric) return;
  const timestamp = now();
  metric.commitCount += 1;
  metric.firstCommitAt ??= timestamp;
  metric.lastCommitAt = timestamp;
  metric.latestContentLength = contentLength;
}

export function recordStreamingParse(key: string, durationMs: number): void {
  const metric = metricFor(key);
  if (!metric) return;
  metric.parseCount += 1;
  metric.totalParseMs += durationMs;
  metric.latestParseMs = durationMs;
  metric.longestParseMs = Math.max(metric.longestParseMs, durationMs);
}

export function recordStreamingShape(
  key: string,
  stableBlockCount: number,
  tailLength: number,
): void {
  const metric = metricFor(key);
  if (!metric) return;
  metric.stableBlockCount = stableBlockCount;
  metric.tailLength = tailLength;
}

function snapshot(metric: MutableStreamingRenderMetrics): StreamingRenderMetricsSnapshot {
  const commitWindow =
    metric.firstCommitAt != null && metric.lastCommitAt != null
      ? metric.lastCommitAt - metric.firstCommitAt
      : 0;
  return {
    key: metric.key,
    deltaCount: metric.deltaCount,
    commitCount: metric.commitCount,
    averageCommitIntervalMs:
      metric.commitCount > 1 ? commitWindow / (metric.commitCount - 1) : 0,
    parseCount: metric.parseCount,
    averageParseMs: metric.parseCount > 0 ? metric.totalParseMs / metric.parseCount : 0,
    latestParseMs: metric.latestParseMs,
    longestParseMs: metric.longestParseMs,
    stableBlockCount: metric.stableBlockCount,
    tailLength: metric.tailLength,
    latestContentLength: metric.latestContentLength,
    layoutShiftScore: metric.layoutShiftScore,
    longTaskCount: metric.longTaskCount,
    longestTaskMs: metric.longestTaskMs,
    active: metric.active,
  };
}

export function getStreamingRenderMetrics(): StreamingRenderMetricsSnapshot[] {
  return Array.from(metrics.values(), snapshot);
}

export function getLatestStreamingParseMs(key: string): number {
  return metrics.get(key)?.latestParseMs ?? 0;
}

export function resetStreamingRenderMetrics(): void {
  metrics.clear();
  activeKeys.clear();
}

declare global {
  interface Window {
    __xopcStreamingRenderMetrics?: () => StreamingRenderMetricsSnapshot[];
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__xopcStreamingRenderMetrics = getStreamingRenderMetrics;
}
