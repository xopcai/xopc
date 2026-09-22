import { describe, expect, it } from 'vitest';

import type { ManagedDevice } from './management-api';
import { filterManagedDevices, isManagedDeviceStale, managedDeviceStatus } from './management-model';

function device(patch: Partial<ManagedDevice> = {}): ManagedDevice {
  return {
    id: 'device-1',
    displayName: 'Phone',
    kind: 'mobile',
    platform: 'android',
    createdAt: 100,
    access: { createdAt: 100, scopes: [] },
    principal: { createdAt: 100 },
    endpoints: [],
    ...patch,
  };
}

describe('managed device model', () => {
  it('derives online, offline and fully revoked states', () => {
    expect(managedDeviceStatus(device())).toBe('offline');
    expect(managedDeviceStatus(device({ endpoints: [{ connectionId: 'c' }] as ManagedDevice['endpoints'] }))).toBe('online');
    expect(managedDeviceStatus(device({
      access: { createdAt: 100, scopes: [], revokedAt: 200 },
      principal: { createdAt: 100, revokedAt: 200 },
    }))).toBe('revoked');
  });

  it('treats only inactive devices older than 30 days as stale', () => {
    const now = 31 * 24 * 60 * 60 * 1_000;
    expect(isManagedDeviceStale(device({ createdAt: 0 }), now)).toBe(true);
    expect(isManagedDeviceStale(device({ createdAt: now - 1_000 }), now)).toBe(false);
  });

  it('filters by active state, platform and identity text', () => {
    const revoked = device({
      id: 'revoked',
      access: { createdAt: 100, scopes: [], revokedAt: 200 },
      principal: { createdAt: 100, revokedAt: 200 },
    });
    const browser = device({ id: 'browser-id', displayName: 'Office Chrome', kind: 'browser', platform: 'chrome' });
    const rows = [device(), revoked, browser];
    expect(filterManagedDevices(rows, { query: '', status: 'active', platform: '' })).toHaveLength(2);
    expect(filterManagedDevices(rows, { query: 'office', status: 'all', platform: 'chrome' })).toEqual([browser]);
    expect(filterManagedDevices(rows, { query: 'browser-id', status: 'all', platform: '' })).toEqual([browser]);
  });
});
