import { describe, expect, it } from 'vitest';

import { workDiscoveryFingerprintsEqual } from '../incremental.js';

describe('incremental work discovery', () => {
  const fingerprint = {
    branch: 'main',
    changedFileCount: 2,
    recentAreas: ['src/work-discovery'],
    contentSignature: 'abc',
    generatedAt: 100,
  };

  it('ignores check time but detects content and activity changes', () => {
    expect(workDiscoveryFingerprintsEqual(fingerprint, { ...fingerprint, generatedAt: 200 })).toBe(true);
    expect(workDiscoveryFingerprintsEqual(fingerprint, { ...fingerprint, contentSignature: 'def' })).toBe(false);
    expect(workDiscoveryFingerprintsEqual(fingerprint, { ...fingerprint, changedFileCount: 3 })).toBe(false);
    expect(workDiscoveryFingerprintsEqual(undefined, fingerprint)).toBe(false);
  });
});
