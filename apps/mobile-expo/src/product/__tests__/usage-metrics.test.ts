import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('../../storage/mmkv', () => ({
  KEYS: { usageEvents: 'product.usageEvents' },
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string | number | boolean) => memory.set(key, String(value)),
    delete: (key: string) => memory.delete(key),
  },
}));

import {
  clearUsageEvents,
  readPerformanceSummary,
  readUsageSummary,
  recordPerformanceEvent,
  recordUsageEvent,
} from '../usage-metrics';

describe('usage metrics', () => {
  beforeEach(() => memory.clear());

  it('stores only event names and timestamps', () => {
    recordUsageEvent('home_viewed', 10);
    recordUsageEvent('capture_completed', 20);

    expect(readUsageSummary()).toEqual({ home_viewed: 1, capture_completed: 1 });
    expect(memory.get('product.usageEvents')).toBe(
      '[{"name":"home_viewed","at":10},{"name":"capture_completed","at":20}]',
    );
  });

  it('clears the bounded local history', () => {
    recordUsageEvent('ask_ai_started', 10);
    clearUsageEvents();
    expect(readUsageSummary()).toEqual({});
  });

  it('stores rounded local performance durations without user content', () => {
    recordPerformanceEvent('app_shell_rendered', 123.6, 20);

    expect(readUsageSummary()).toEqual({ app_shell_rendered: 1 });
    expect(memory.get('product.usageEvents')).toBe(
      '[{"name":"app_shell_rendered","at":20,"durationMs":124}]',
    );
    expect(readPerformanceSummary()).toEqual({
      app_shell_rendered: { averageMs: 124, count: 1, latestMs: 124 },
    });
  });

  it('records each startup marker once per app lifecycle', () => {
    clearUsageEvents();
    recordPerformanceEvent('home_content_ready', 200, 20);
    recordPerformanceEvent('home_content_ready', 900, 30);

    expect(readPerformanceSummary()).toEqual({
      home_content_ready: { averageMs: 200, count: 1, latestMs: 200 },
    });
  });
});
