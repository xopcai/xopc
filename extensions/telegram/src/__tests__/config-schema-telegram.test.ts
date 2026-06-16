import { describe, it, expect } from 'vitest';

import { TelegramConfigSchema } from '../config-schema.js';

describe('TelegramConfigSchema', () => {
  it('accepts account ids from accounts map keys', () => {
    const r = TelegramConfigSchema.safeParse({
      enabled: true,
      accounts: {
        personal: { botToken: '123:TOKEN' },
      },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.accounts?.personal?.accountId).toBeUndefined();
    expect(r.data.accounts?.personal?.botToken).toBe('123:TOKEN');
  });

  it('rejects old top-level token and streamMode fields', () => {
    const r = TelegramConfigSchema.safeParse({
      enabled: true,
      botToken: '123:TOP',
      streamMode: 'partial',
      accounts: { default: { botToken: '999:KEEP' } },
    });
    expect(r.success).toBe(false);
  });
});
