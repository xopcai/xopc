import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../schema.js';

describe('session reset config', () => {
  it('accepts the current reset shape', () => {
    expect(
      ConfigSchema.safeParse({
        session: { reset: { mode: 'idle', idleMinutes: 30 } },
      }).success,
    ).toBe(true);
  });

  it('rejects the removed top-level idleMinutes field', () => {
    expect(
      ConfigSchema.safeParse({
        session: { idleMinutes: 30 },
      }).success,
    ).toBe(false);
  });
});
