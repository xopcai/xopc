import { describe, expect, it } from 'vitest';

import { DingtalkConfigSchema } from '../config-schema.js';

describe('DingtalkConfigSchema', () => {
  it('parses minimal valid config', () => {
    const parsed = DingtalkConfigSchema.parse({
      enabled: true,
      clientId: 'dingxxx',
      clientSecret: 'secret',
    });
    expect(parsed.enabled).toBe(true);
    expect(parsed.clientId).toBe('dingxxx');
  });

  it('rejects unknown keys (strict)', () => {
    expect(() =>
      DingtalkConfigSchema.parse({
        clientId: 'x',
        extraField: 1,
      }),
    ).toThrow();
  });
});
