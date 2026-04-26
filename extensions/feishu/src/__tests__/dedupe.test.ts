import { describe, expect, it } from 'vitest';

import { createFeishuDedupe } from '../transport/reliability/dedupe.js';

describe('createFeishuDedupe', () => {
  it('dedupes message ids', () => {
    const d = createFeishuDedupe({ ttlMs: 60_000 });
    expect(d.claim('m1')).toBe(true);
    expect(d.claim('m1')).toBe(false);
    expect(d.claim('m2')).toBe(true);
  });
});

