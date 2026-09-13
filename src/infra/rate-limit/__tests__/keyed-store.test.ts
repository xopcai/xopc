import { expect, it } from 'vitest';
import { KeyedStore } from '../keyed-store.js';
it('bounds attacker-controlled keys and shares overflow state instead of resetting it', () => {
  const store = new KeyedStore<{ lastTouchedMs: number; failures: number }>({ staleAfterMs: 1000, maxEntries: 2 });
  try {
    for (let i = 0; i < 100; i++) {
      const key = String(i);
      const state = store.get(key) ?? { lastTouchedMs: Date.now(), failures: 0 };
      state.failures++;
      store.set(key, state);
    }
    expect(store.size()).toBe(2);
    expect(store.get('another-attacker')?.failures).toBe(98);
    store.delete('another-attacker');
    expect(store.get('new-address')?.failures).toBe(98);
  } finally { store.destroy(); }
});
