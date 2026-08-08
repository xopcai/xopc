import { describe, expect, it } from 'vitest';

import { userContextViewFromTab } from '../user-context-navigation';

describe('userContextViewFromTab', () => {
  it.each(['overview', 'memory', 'collaboration', 'sources', 'privacy'] as const)(
    'selects the %s view',
    (view) => {
      expect(userContextViewFromTab(view)).toBe(view);
    },
  );

  it('falls back to overview for missing or unknown tabs', () => {
    expect(userContextViewFromTab(null)).toBe('overview');
    expect(userContextViewFromTab('unknown')).toBe('overview');
  });
});
