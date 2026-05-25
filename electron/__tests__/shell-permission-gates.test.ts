import { describe, expect, it } from 'vitest';

import { tccToTriState } from '../ipc/shell-permission-gates.js';

describe('tccToTriState', () => {
  it('maps granted', () => {
    expect(tccToTriState('granted')).toBe('granted');
  });

  it('maps denied and restricted', () => {
    expect(tccToTriState('denied')).toBe('denied');
    expect(tccToTriState('restricted')).toBe('denied');
  });

  it('maps not-determined and unknown to unknown', () => {
    expect(tccToTriState('not-determined')).toBe('unknown');
    expect(tccToTriState('unknown')).toBe('unknown');
  });
});
