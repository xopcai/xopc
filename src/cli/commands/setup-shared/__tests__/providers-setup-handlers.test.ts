import { describe, expect, it } from 'vitest';

import { ensureSetupHandlersLoaded, getSetupHandler } from '../index.js';

describe('providers setup handlers', () => {
  it('registers list, set-key, and unset-key handlers', async () => {
    await ensureSetupHandlersLoaded();
    expect(getSetupHandler('providers', 'list')).toBeDefined();
    expect(getSetupHandler('providers', 'set-key')).toBeDefined();
    expect(getSetupHandler('providers', 'unset-key')).toBeDefined();
  });

  it('set-key rejects missing key for non-interactive setup', async () => {
    await ensureSetupHandlersLoaded();
    const entry = getSetupHandler('providers', 'set-key');
    expect(entry).toBeDefined();
    const outcome = await entry!.handler({
      configPath: '/tmp/nonexistent-xopc-test.json',
      fields: { provider: 'openai' },
      options: { dryRun: true, json: true },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors?.[0]?.path).toBe('key');
    expect(outcome.errors?.[0]?.message).toMatch(/fields.key required/);
  });

  it('list returns provider entries without writing', async () => {
    await ensureSetupHandlersLoaded();
    const entry = getSetupHandler('providers', 'list');
    const outcome = await entry!.handler({
      configPath: '/tmp/nonexistent-xopc-test.json',
      fields: {},
      options: { dryRun: false, json: true },
    });
    expect(outcome.ok).toBe(true);
    const value = outcome.value as { providers?: Array<{ id: string }> };
    expect(Array.isArray(value.providers)).toBe(true);
    expect(value.providers!.some((p) => p.id === 'openai')).toBe(true);
  });
});
