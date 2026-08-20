import { describe, expect, it } from 'vitest';

import { normalizePersonalContextSources } from '../ipc/personal-context-ipc.js';

describe('personal context source selection', () => {
  it('requires an explicit source list', () => {
    expect(normalizePersonalContextSources(undefined)).toEqual([]);
    expect(normalizePersonalContextSources('calendar')).toEqual([]);
  });

  it('keeps known sources once and ignores unknown values', () => {
    expect(normalizePersonalContextSources([
      'calendar',
      'unknown',
      'calendar',
      'apple_notes',
      1,
    ])).toEqual(['calendar', 'apple_notes']);
  });
});
