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
  recordInteractionPerformanceEvent,
  readUsageSummary,
  recordPerformanceEvent,
  recordUsageEvent,
} from '../usage-metrics';

describe('usage metrics', () => {
  beforeEach(() => memory.clear());

  it('stores only event names and timestamps', () => {
    recordUsageEvent('gateway_switch_completed', 10);
    recordUsageEvent('notification_opened', 20);

    expect(readUsageSummary()).toEqual({
      gateway_switch_completed: 1,
      notification_opened: 1,
    });
    expect(memory.get('product.usageEvents')).toBe(
      '[{"name":"gateway_switch_completed","at":10},{"name":"notification_opened","at":20}]',
    );
  });

  it('clears the bounded local history', () => {
    recordUsageEvent('capture_completed', 10);
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
    recordPerformanceEvent('app_shell_rendered', 200, 20);
    recordPerformanceEvent('app_shell_rendered', 900, 30);

    expect(readPerformanceSummary()).toEqual({
      app_shell_rendered: { averageMs: 200, count: 1, latestMs: 200 },
    });
  });

  it('records every interaction duration for performance distributions', () => {
    clearUsageEvents();
    recordInteractionPerformanceEvent('read_aloud_first_audio', 100.4, 10);
    recordInteractionPerformanceEvent('read_aloud_first_audio', 201.4, 20);

    expect(readPerformanceSummary()).toEqual({
      read_aloud_first_audio: { averageMs: 151, count: 2, latestMs: 201 },
    });
  });
});
