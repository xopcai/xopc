import { describe, it, expect } from 'vitest';
import { resolveWebSearchRegion } from '../region.js';

describe('resolveWebSearchRegion', () => {
  it('respects explicit cn', () => {
    expect(resolveWebSearchRegion({ region: 'cn' })).toBe('cn');
  });

  it('respects explicit global', () => {
    expect(resolveWebSearchRegion({ region: 'global' })).toBe('global');
  });

  it('defaults when unset is cn or global (timezone-based)', () => {
    const r = resolveWebSearchRegion(undefined);
    expect(['cn', 'global'] as const).toContain(r);
  });
});
