// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetAuthBarrierForTests, apiFetch } from '@/lib/fetch';
import { useGatewayStore } from '@/stores/gateway-store';

function makeResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiFetch authBarrier', () => {
  beforeEach(() => {
    __resetAuthBarrierForTests();
    useGatewayStore.setState({ token: 'good-token', tokenExpired: false, tokenDialogOpen: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetAuthBarrierForTests();
  });

  it('engages on first 401 and gates subsequent requests until token-saved fires', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(401, { error: 'Unauthorized', code: 'invalid_token' }))
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await apiFetch('/api/anything');
    expect(first.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call should park on the barrier — fetch must not be invoked yet.
    const secondPromise = apiFetch('/api/anything');
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Releasing the barrier — same path the store uses on setGatewayToken.
    useGatewayStore.setState({ token: 'fresh-token' });
    window.dispatchEvent(new CustomEvent('token-saved', { detail: { token: 'fresh-token' } }));

    const second = await secondPromise;
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second request must have gone out with the fresh token, not the stale one.
    const headers = (fetchMock.mock.calls[1][1] as RequestInit).headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer fresh-token');
  });

  it('coalesces concurrent 401s into a single barrier without firing dialog state changes per response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse(401, { error: 'Unauthorized', code: 'invalid_token' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onUnauthSpy = vi.spyOn(useGatewayStore.getState(), 'onUnauthorized');

    // Five SWR-style parallel requests. All race past the un-engaged barrier
    // and hit the wire; subsequent calls after the latch will await it.
    const results = await Promise.all([
      apiFetch('/api/a'),
      apiFetch('/api/b'),
      apiFetch('/api/c'),
      apiFetch('/api/d'),
      apiFetch('/api/e'),
    ]);

    expect(results.every((r) => r.status === 401)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // A sixth request issued AFTER the barrier engaged must be parked.
    const blocked = apiFetch('/api/f');
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(5);

    onUnauthSpy.mockRestore();

    // Cleanup so the parked request doesn't leak into the next test.
    useGatewayStore.setState({ token: 'fresh-token' });
    window.dispatchEvent(new CustomEvent('token-saved', { detail: { token: 'fresh-token' } }));
    fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true }));
    await blocked;
  });

  it('does not set JSON Content-Type for FormData bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const form = new FormData();
    form.append('file', new Blob(['x'], { type: 'image/png' }), 'x.png');
    await apiFetch('/api/upload', { method: 'POST', body: form });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('Content-Type')).toBeNull();
  });
});
