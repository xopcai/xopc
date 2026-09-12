import { describe, expect, it } from 'vitest';

import { __snapshotFromNetInfoStateForTests } from '../network-info';

describe('network info snapshots', () => {
  it('treats a disconnected Wi-Fi transport as offline', () => {
    expect(__snapshotFromNetInfoStateForTests({ type: 'wifi', isConnected: false })).toEqual({
      key: 'offline:offline',
      kind: 'offline',
      online: false,
    });
  });

  it('does not trust a generic reachability probe over an active transport', () => {
    expect(__snapshotFromNetInfoStateForTests({
      type: 'cellular',
      isConnected: true,
      isInternetReachable: false,
    })).toEqual({
      key: 'cellular:cell',
      kind: 'cellular',
      online: true,
    });
  });

  it('preserves a reachable transport kind', () => {
    expect(__snapshotFromNetInfoStateForTests({
      type: 'cellular',
      isConnected: true,
      isInternetReachable: true,
      details: { cellularGeneration: '5g' },
    })).toEqual({
      key: 'cellular:5g',
      kind: 'cellular',
      online: true,
    });
  });
});
