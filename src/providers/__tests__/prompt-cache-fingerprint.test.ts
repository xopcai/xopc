import { describe, expect, it } from 'vitest';

import { canonicalizeCacheValue } from '../prompt-cache-fingerprint.js';

describe('prompt cache fingerprint', () => {
  it('is stable across object key order', () => {
    expect(canonicalizeCacheValue({ b: 2, a: 1 }))
      .toBe(canonicalizeCacheValue({ a: 1, b: 2 }));
  });

  it('bounds circular and oversized values', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(canonicalizeCacheValue(circular)).toContain('[circular]');
    expect(canonicalizeCacheValue('x'.repeat(100_100))).toContain('[fingerprint-limit]');
  });
});
