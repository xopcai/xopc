import type { ManagedDevice } from './management-api';

export type ManagedDeviceStatus = 'online' | 'offline' | 'revoked';
export type ManagedDeviceStatusFilter = 'active' | 'all' | ManagedDeviceStatus | 'stale';

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1_000;

export function isManagedDeviceRevoked(device: ManagedDevice): boolean {
  const identities = [device.access, device.principal].filter((identity) => identity !== null);
  return identities.length > 0 && identities.every((identity) => identity.revokedAt !== undefined);
}

export function managedDeviceStatus(device: ManagedDevice): ManagedDeviceStatus {
  if (isManagedDeviceRevoked(device)) return 'revoked';
  return device.endpoints.length > 0 ? 'online' : 'offline';
}

export function managedDeviceToolCount(device: ManagedDevice): number {
  return new Set(device.endpoints.flatMap((endpoint) => endpoint.tools.map(({ descriptor }) => descriptor.name))).size;
}

export function isManagedDeviceStale(device: ManagedDevice, now = Date.now()): boolean {
  if (managedDeviceStatus(device) !== 'offline') return false;
  return (device.lastSeenAt ?? device.createdAt) < now - STALE_AFTER_MS;
}

export function filterManagedDevices(
  devices: ManagedDevice[],
  filters: { query: string; status: ManagedDeviceStatusFilter; platform: string },
  now = Date.now(),
): ManagedDevice[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return devices.filter((device) => {
    const status = managedDeviceStatus(device);
    const matchesStatus = filters.status === 'all'
      || (filters.status === 'active' ? status !== 'revoked'
        : filters.status === 'stale' ? isManagedDeviceStale(device, now)
          : status === filters.status);
    const matchesPlatform = !filters.platform || device.platform === filters.platform;
    const matchesQuery = !query || [device.displayName, device.id, device.kind, device.platform]
      .some((value) => value.toLocaleLowerCase().includes(query));
    return matchesStatus && matchesPlatform && matchesQuery;
  });
}

export function shortDeviceId(id: string): string {
  return id.length > 8 ? id.slice(-8) : id;
}
