import { describe, expect, it } from 'vitest';

import type { Config } from '../../../../../config/schema.js';
import { applyMiscPatch } from '../misc.js';

function config(): Config {
  return {
    agents: {
      default: 'main',
      list: [
        { id: 'main' },
        { id: 'coder' },
        { id: 'writer', enabled: false },
      ],
    },
    tui: { defaultAgent: 'coder' },
    gateway: { port: 18790, corsOrigins: [] },
    channels: {},
  } as unknown as Config;
}

describe('applyMiscPatch tui', () => {
  it('persists tui.defaultAgent for an enabled agent', async () => {
    const cfg = config();
    const result = await applyMiscPatch(cfg, { tui: { defaultAgent: ' MAIN ' } });

    expect(result.ok).toBe(true);
    expect(cfg.tui?.defaultAgent).toBe('main');
  });

  it('clears tui.defaultAgent to inherit the global default', async () => {
    const cfg = config();
    const result = await applyMiscPatch(cfg, { tui: { defaultAgent: null } });

    expect(result.ok).toBe(true);
    expect(cfg.tui?.defaultAgent).toBeUndefined();
  });

  it('rejects unavailable tui.defaultAgent targets', async () => {
    await expect(applyMiscPatch(config(), { tui: { defaultAgent: 'missing' } })).resolves.toMatchObject({
      ok: false,
      error: { message: 'Agent "missing" not found or disabled.' },
    });
    await expect(applyMiscPatch(config(), { tui: { defaultAgent: 'writer' } })).resolves.toMatchObject({
      ok: false,
      error: { message: 'Agent "writer" not found or disabled.' },
    });
  });
});
