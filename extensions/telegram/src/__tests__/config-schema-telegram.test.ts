import { describe, it, expect } from 'vitest';

import { TelegramConfigSchema } from '../config-schema.js';

describe('TelegramConfigSchema', () => {
  it('accepts account ids from accounts map keys', () => {
    const r = TelegramConfigSchema.safeParse({
      enabled: true,
      defaults: { dmPolicy: 'pairing', streaming: { mode: 'partial' } },
      accounts: {
        personal: { botToken: '123:TOKEN' },
      },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.accounts?.personal?.accountId).toBeUndefined();
    expect(r.data.accounts?.personal?.botToken).toBe('123:TOKEN');
    expect(r.data.defaults.dmPolicy).toBe('pairing');
  });

  it('rejects old top-level token, policy, allowlist, and streaming fields', () => {
    const r = TelegramConfigSchema.safeParse({
      enabled: true,
      botToken: '123:TOP',
      dmPolicy: 'pairing',
      groupPolicy: 'open',
      allowFrom: ['1'],
      groupAllowFrom: ['2'],
      streaming: { mode: 'partial' },
      apiRoot: 'https://api.telegram.org',
      proxy: 'http://127.0.0.1:7897',
      accounts: { default: { botToken: '999:KEEP' } },
    });
    expect(r.success).toBe(false);
  });
});
