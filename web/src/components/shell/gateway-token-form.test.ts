// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyGatewayCredential } from './gateway-token-form';

describe('verifyGatewayCredential', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects an invalid token before it is persisted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyGatewayCredential('invalid-token')).resolves.toBe('rejected');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/config$/),
      expect.objectContaining({ headers: { Authorization: 'Bearer invalid-token' } }),
    );
  });

  it('distinguishes an unreachable gateway from a rejected token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(verifyGatewayCredential('candidate-token')).resolves.toBe('unreachable');
  });
});
