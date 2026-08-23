import { describe, expect, it } from 'vitest';

import { isSTTAvailable } from '../availability.js';

describe('isSTTAvailable', () => {
  it('allows runtime-configured OAuth providers without a stored config slice', () => {
    expect(isSTTAvailable({
      enabled: true,
      provider: 'xopc-cloud',
      fallback: { enabled: false, order: [] },
    })).toBe(true);
  });

  it('still rejects credential providers without configuration', () => {
    expect(isSTTAvailable({
      enabled: true,
      provider: 'openai',
      fallback: { enabled: false, order: [] },
    })).toBe(false);
  });
});
