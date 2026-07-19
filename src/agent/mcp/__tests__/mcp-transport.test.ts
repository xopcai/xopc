import { describe, expect, it, vi } from 'vitest';

import { __testing } from '../mcp-transport.js';

describe('connector-authenticated MCP transport', () => {
  it('refreshes the user token and retries once after a 401', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const accessToken = vi.fn(async (_providerId: string, { forceRefresh }: { forceRefresh?: boolean }) =>
      forceRefresh ? 'refreshed-token' : 'current-token',
    );
    const authenticatedFetch = __testing.createConnectorAuthFetch('github-app', fetchImpl, accessToken);

    const response = await authenticatedFetch(new URL('https://api.githubcopilot.com/mcp/'), {
      method: 'POST',
      headers: { 'X-Test': 'preserved' },
      body: '{}',
    });

    expect(response.status).toBe(200);
    expect(accessToken).toHaveBeenNthCalledWith(1, 'github-app', { forceRefresh: false });
    expect(accessToken).toHaveBeenNthCalledWith(2, 'github-app', { forceRefresh: true });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer refreshed-token',
        'x-test': 'preserved',
      }),
    }));
  });
});
