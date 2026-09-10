import { describe, expect, it, vi } from 'vitest';

import type { KeyValueStorage } from '../../../storage/mmkv';
import { createConsentDecisionStorage } from '../consent-storage';

vi.mock('../../../storage/mmkv', () => ({
  storage: {
    getString: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  },
}));

function memoryStorage(values = new Map<string, string>()): KeyValueStorage {
  return {
    getString: (key) => values.get(key),
    set: (key, value) => values.set(key, String(value)),
    delete: (key) => { values.delete(key); },
  };
}

describe('consent decision storage', () => {
  it('restores an accepted disclosure revision after the volatile cache restarts', () => {
    const durableValues = new Map<string, string>();
    const durable = {
      getString: (key: string) => durableValues.get(key),
      set: (key: string, value: string) => { durableValues.set(key, value); },
    };
    const key = 'privacy.dataSharing.v1:gateway-one';

    createConsentDecisionStorage(memoryStorage(), durable).set(key, 'revision-one');

    const restartedCache = new Map<string, string>();
    const restarted = createConsentDecisionStorage(memoryStorage(restartedCache), durable);
    expect(restarted.getString(key)).toBe('revision-one');
    expect(restartedCache.get(key)).toBe('revision-one');
  });

  it('prefers the current MMKV value and persists denials too', () => {
    const cacheValues = new Map([['consent', 'revision-two']]);
    const durableValues = new Map([['consent', 'revision-one']]);
    const storage = createConsentDecisionStorage(memoryStorage(cacheValues), {
      getString: (key) => durableValues.get(key),
      set: (key, value) => { durableValues.set(key, value); },
    });

    expect(storage.getString('consent')).toBe('revision-two');
    storage.set('consent', 'denied');
    expect(cacheValues.get('consent')).toBe('denied');
    expect(durableValues.get('consent')).toBe('denied');
  });
});
