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

import { clearUsageEvents, readUsageSummary, recordUsageEvent } from '../usage-metrics';

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
});
