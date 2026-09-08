import type { PlatformDiscovery } from './contracts.js';

let activeDiscovery: PlatformDiscovery | undefined;

export function setActivePlatformDiscovery(discovery: PlatformDiscovery | undefined): void {
  activeDiscovery = discovery;
}

export function resolveConnectedPlatformDiscovery(): PlatformDiscovery | undefined {
  return activeDiscovery;
}

export function resolveConnectedPlatformEndpoint(
  endpoint: keyof PlatformDiscovery['endpoints'],
): string | undefined {
  return resolveConnectedPlatformDiscovery()?.endpoints[endpoint];
}
