// src/infra/update-channels.ts

export type UpdateChannel = 'stable' | 'beta' | 'dev';

export const DEFAULT_PACKAGE_CHANNEL: UpdateChannel = 'stable';
export const DEFAULT_GIT_CHANNEL: UpdateChannel = 'dev';

/**
 * Map update channel to the npm dist-tag used for querying registry.
 * stable → latest, beta → beta, dev → dev
 */
export function channelToNpmTag(channel: UpdateChannel): string {
  if (channel === 'beta') return 'beta';
  if (channel === 'dev') return 'dev';
  return 'latest';
}

/** Normalize a user-provided string to a valid UpdateChannel, or null. */
export function normalizeUpdateChannel(value?: string | null): UpdateChannel | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'stable' || normalized === 'beta' || normalized === 'dev') {
    return normalized;
  }
  return null;
}

/** Return true if a version/tag string contains a beta prerelease identifier. */
export function isBetaVersion(version: string): boolean {
  return /(?:^|[.-])beta(?:[.-]|$)/i.test(version);
}

/** Return true if a version string is a stable release (no beta marker in this heuristic). */
export function isStableVersion(version: string): boolean {
  return !isBetaVersion(version);
}
