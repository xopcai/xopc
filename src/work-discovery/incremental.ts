import type { WorkDiscoveryPreview } from './types.js';

export function workDiscoveryFingerprintsEqual(
  left: WorkDiscoveryPreview['fingerprint'] | undefined,
  right: WorkDiscoveryPreview['fingerprint'],
): boolean {
  if (!left) return false;
  return left.branch === right.branch
    && left.changedFileCount === right.changedFileCount
    && left.contentSignature === right.contentSignature
    && JSON.stringify(left.recentAreas) === JSON.stringify(right.recentAreas);
}
