import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../schema.js';

describe('scene rollout config', () => {
  it('requires an explicit opt-in', () => {
    expect(ConfigSchema.parse({}).gateway.scenes).toEqual({ enabled: false });
    expect(ConfigSchema.parse({ gateway: { scenes: { enabled: true } } }).gateway.scenes)
      .toEqual({ enabled: true });
  });
});
