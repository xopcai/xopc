import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initializeTestAgentCatalog } from '../../../../../agent-catalog/test-support.js';
import { AgentCatalogRepository } from '../../../../../agent-catalog/repository.js';
import { closeXopcDatabase } from '../../../../../storage/sqlite/index.js';
import type { Config } from '../../../../../config/schema.js';
import { applyMiscPatch } from '../misc.js';

function config(): Config {
  return {
    gateway: { port: 18790, corsOrigins: [] },
    channels: {},
  } as unknown as Config;
}

describe('applyMiscPatch tui', () => {
  beforeEach(() => initializeTestAgentCatalog({
    agents: [
      { id: 'main', enabled: true },
      { id: 'coder', enabled: true },
      { id: 'writer', enabled: false },
    ],
    surfaceDefaults: { tui: 'coder' },
  }));
  afterEach(() => closeXopcDatabase());

  it('persists tui.defaultAgent for an enabled agent', async () => {
    const cfg = config();
    const result = await applyMiscPatch(cfg, { tui: { defaultAgent: ' MAIN ' } });

    expect(result.ok).toBe(true);
    expect(new AgentCatalogRepository().snapshot().surfaceDefaults.tui).toBe('main');
  });

  it('clears tui.defaultAgent to inherit the global default', async () => {
    const cfg = config();
    const result = await applyMiscPatch(cfg, { tui: { defaultAgent: null } });

    expect(result.ok).toBe(true);
    expect(new AgentCatalogRepository().snapshot().surfaceDefaults.tui).toBeUndefined();
  });

  it('rejects unavailable tui.defaultAgent targets', async () => {
    await expect(applyMiscPatch(config(), { tui: { defaultAgent: 'missing' } })).resolves.toMatchObject({
      ok: false,
      error: { message: 'Agent "missing" is not available' },
    });
    await expect(applyMiscPatch(config(), { tui: { defaultAgent: 'writer' } })).resolves.toMatchObject({
      ok: false,
      error: { message: 'Agent "writer" is not available' },
    });
  });
});
