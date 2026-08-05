import { describe, expect, it, vi } from 'vitest';

import { refreshOnboardModelCatalogIfNeeded } from '../model.js';

describe('refreshOnboardModelCatalogIfNeeded', () => {
  it('loads the XOPC Cloud catalog when the local catalog is empty', async () => {
    const refresh = vi.fn(async () => ({
      status: 'updated' as const,
      modelCount: 2,
      models: ['deepseek-v4-flash', 'glm-5'],
    }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await refreshOnboardModelCatalogIfNeeded('xopc-cloud', false, { refresh });

    expect(refresh).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it('keeps a usable cached XOPC Cloud catalog without a network refresh', async () => {
    const refresh = vi.fn();

    await refreshOnboardModelCatalogIfNeeded('xopc-cloud', true, { refresh });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not refresh catalog-backed providers other than XOPC Cloud', async () => {
    const refresh = vi.fn();

    await refreshOnboardModelCatalogIfNeeded('openai', false, { refresh });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports missing credentials instead of continuing with an empty catalog', async () => {
    const refresh = vi.fn(async () => ({ status: 'skipped' as const, reason: 'not_configured' as const }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      refreshOnboardModelCatalogIfNeeded('xopc-cloud', false, { refresh }),
    ).rejects.toThrow('credentials are unavailable after OAuth login');
    log.mockRestore();
  });
});
