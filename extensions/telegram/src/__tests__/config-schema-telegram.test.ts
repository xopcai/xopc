import { describe, it, expect } from 'vitest';

import { TelegramConfigSchema } from '../config-schema.js';

describe('TelegramConfigSchema', () => {
  it('migrates legacy top-level botToken into accounts.default', () => {
    const r = TelegramConfigSchema.safeParse({
      enabled: true,
      botToken: '123:LEGACY',
      accounts: {},
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect('botToken' in r.data).toBe(false);
    expect(r.data.accounts?.default?.botToken).toBe('123:LEGACY');
  });

  it('does not overwrite accounts.default.botToken when legacy top-level is present', () => {
    const r = TelegramConfigSchema.safeParse({
      enabled: true,
      botToken: 'legacy:SHOULD_NOT_WIN',
      accounts: { default: { accountId: 'default', botToken: '999:KEEP' } },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.accounts?.default?.botToken).toBe('999:KEEP');
  });
});
