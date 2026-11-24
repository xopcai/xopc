// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, mutateMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  mutateMock: vi.fn(async () => undefined),
}));

vi.mock('@/lib/gateway-startup-retry', () => ({
  apiFetchWithStartupRetry: fetchMock,
}));

vi.mock('swr', () => ({
  mutate: mutateMock,
}));

import { fetchConfiguredModelsCached, invalidateConfiguredModelsCache } from '../api/registry-api';

function modelsResponse(models: Array<{ id: string; name: string; provider: string }>): Response {
  return new Response(JSON.stringify({ payload: { models } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('configured models cache invalidation', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    mutateMock.mockClear();
    await invalidateConfiguredModelsCache();
  });

  it('prevents a stale pre-invalidation in-flight response from poisoning the cache', async () => {
    let resolveStale!: (response: Response) => void;
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveStale = resolve; }))
      .mockResolvedValueOnce(modelsResponse([{ id: 'xopc-cloud/auto', name: 'Auto', provider: 'xopc-cloud' }]));

    const staleRequest = fetchConfiguredModelsCached();
    await invalidateConfiguredModelsCache();

    const freshModels = await fetchConfiguredModelsCached();
    expect(freshModels.map((item) => item.id)).toEqual(['xopc-cloud/auto']);

    resolveStale(modelsResponse([]));
    await expect(staleRequest).resolves.toEqual([]);

    const cachedAfterStale = await fetchConfiguredModelsCached();
    expect(cachedAfterStale.map((item) => item.id)).toEqual(['xopc-cloud/auto']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
