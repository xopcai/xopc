import { describe, expect, it } from 'vitest';

import { isHeartbeatContentEmpty } from '../content-check.js';

describe('isHeartbeatContentEmpty', () => {
  it('returns true for headings and blanks only', () => {
    expect(
      isHeartbeatContentEmpty(`# Title\n\n- [ ]\n\n`),
    ).toBe(true);
  });

  it('returns false when there is body text', () => {
    expect(isHeartbeatContentEmpty('# Hi\n\nDo something')).toBe(false);
  });
});
