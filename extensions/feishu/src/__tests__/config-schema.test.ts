import { describe, expect, it } from 'vitest';

import { FeishuConfigSchema } from '../schema/config-schema.js';

describe('FeishuConfigSchema', () => {
  it('accepts disabled config without credentials', () => {
    const r = FeishuConfigSchema.safeParse({ enabled: false });
    expect(r.success).toBe(true);
  });

  it('rejects enabled config without credentials (single-account)', () => {
    const r = FeishuConfigSchema.safeParse({ enabled: true });
    expect(r.success).toBe(false);
  });

  it('accepts enabled config with top-level credentials', () => {
    const r = FeishuConfigSchema.safeParse({ enabled: true, appId: 'a', appSecret: 'b' });
    expect(r.success).toBe(true);
  });

  it('accepts enabled multi-account config when account inherits top-level credentials', () => {
    const r = FeishuConfigSchema.safeParse({
      enabled: true,
      appId: 'a',
      appSecret: 'b',
      accounts: { work: { enabled: true } },
    });
    expect(r.success).toBe(true);
  });
});

