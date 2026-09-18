import { describe, expect, it } from 'vitest';

import { deriveCapabilityDisplayStatus } from '../model-catalog-status';

describe('deriveCapabilityDisplayStatus', () => {
  it('treats an optional capability that was never configured as neutral', () => {
    expect(deriveCapabilityDisplayStatus({
      status: 'unavailable',
      selectionSource: 'none',
      rejected: [],
    })).toBe('not-configured');
  });

  it('requires attention when a configured model was rejected', () => {
    expect(deriveCapabilityDisplayStatus({
      status: 'unavailable',
      selectionSource: 'none',
      rejected: [{ provider: 'example', model: 'missing' }],
    })).toBe('misconfigured');
  });

  it('keeps degraded, ready, and disabled states distinct', () => {
    expect(deriveCapabilityDisplayStatus({ status: 'degraded', selectionSource: 'configured-provider' })).toBe('degraded');
    expect(deriveCapabilityDisplayStatus({ status: 'ready', selectionSource: 'configured-provider' })).toBe('ready');
    expect(deriveCapabilityDisplayStatus({ status: 'disabled', selectionSource: 'none' })).toBe('off');
  });
});
