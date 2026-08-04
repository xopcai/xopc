import { describe, expect, it } from 'vitest';

import { advanceElectronHistory } from '@/components/shell/electron-history-state';

describe('advanceElectronHistory', () => {
  it('tracks pushed locations and moves across them with POP', () => {
    let snapshot = advanceElectronHistory(undefined, 'a', 'POP');
    snapshot = advanceElectronHistory(snapshot, 'b', 'PUSH');
    snapshot = advanceElectronHistory(snapshot, 'c', 'PUSH');

    expect(snapshot).toEqual({ entries: ['a', 'b', 'c'], index: 2 });

    snapshot = advanceElectronHistory(snapshot, 'b', 'POP');
    expect(snapshot.index).toBe(1);

    snapshot = advanceElectronHistory(snapshot, 'c', 'POP');
    expect(snapshot.index).toBe(2);
  });

  it('drops the forward branch after pushing from a previous entry', () => {
    let snapshot = advanceElectronHistory(undefined, 'a', 'POP');
    snapshot = advanceElectronHistory(snapshot, 'b', 'PUSH');
    snapshot = advanceElectronHistory(snapshot, 'a', 'POP');
    snapshot = advanceElectronHistory(snapshot, 'c', 'PUSH');

    expect(snapshot).toEqual({ entries: ['a', 'c'], index: 1 });
  });

  it('updates the current entry on replace without adding history', () => {
    let snapshot = advanceElectronHistory(undefined, 'a', 'POP');
    snapshot = advanceElectronHistory(snapshot, 'b', 'REPLACE');

    expect(snapshot).toEqual({ entries: ['b'], index: 0 });
  });
});
