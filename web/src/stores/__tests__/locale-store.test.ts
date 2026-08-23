// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetGatewayLanguageSyncForTests,
  syncElectronLocaleAfterHydration,
} from '@/stores/locale-store';
import { useGatewayStore } from '@/stores/gateway-store';

function jsonResponse(status = 200): Response {
  return new Response(JSON.stringify({ ok: status < 400 }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('gateway locale sync', () => {
  beforeEach(() => {
    __resetGatewayLanguageSyncForTests();
    useGatewayStore.setState({ token: 'test-token' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetGatewayLanguageSyncForTests();
  });

  it('coalesces StrictMode-style duplicate hydration syncs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse());
    vi.stubGlobal('fetch', fetchMock);

    const offFirst = syncElectronLocaleAfterHydration();
    const offSecond = syncElectronLocaleAfterHydration();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await Promise.resolve();

    const offThird = syncElectronLocaleAfterHydration();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    offFirst();
    offSecond();
    offThird();
  });

  it('allows a later trigger to retry after a failed sync', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse())
      .mockResolvedValue(jsonResponse());
    vi.stubGlobal('fetch', fetchMock);

    const offFirst = syncElectronLocaleAfterHydration();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const offSecond = syncElectronLocaleAfterHydration();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    offFirst();
    offSecond();
  });
});
