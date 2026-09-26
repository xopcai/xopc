import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGatewayConnection: vi.fn<() => { port: number; token: string } | undefined>(),
}));

vi.mock('../gateway-process.js', () => ({
  getGatewayConnection: mocks.getGatewayConnection,
}));

import { getAppQuitImpact } from '../quit-impact.js';

describe('getAppQuitImpact', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.getGatewayConnection.mockReset();
  });

  it('allows quitting when no gateway is registered', async () => {
    mocks.getGatewayConnection.mockReturnValue(undefined);
    await expect(getAppQuitImpact()).resolves.toEqual({ shouldConfirm: false, blockingCount: 0 });
  });

  it('returns a bounded title for one blocking run', async () => {
    mocks.getGatewayConnection.mockReturnValue({ port: 18800, token: 'secret' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      payload: {
        shouldConfirm: true,
        blockingCount: 1,
        blockingRuns: [{ title: '  Important task  ' }],
      },
    }), { status: 200 })));

    await expect(getAppQuitImpact()).resolves.toEqual({
      shouldConfirm: true,
      blockingCount: 1,
      taskTitle: 'Important task',
    });
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:18800/api/runtime/quit-impact', expect.objectContaining({
      headers: { Authorization: 'Bearer secret' },
    }));
  });

  it('rejects an invalid response so the caller can fail open', async () => {
    mocks.getGatewayConnection.mockReturnValue({ port: 18800, token: 'secret' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(getAppQuitImpact()).rejects.toThrow('Quit impact response is invalid');
  });
});
