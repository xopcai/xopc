import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

const { listConnectorApprovals } = vi.hoisted(() => ({
  listConnectorApprovals: vi.fn(() => []),
}));

vi.mock('../../../../storage/sqlite/index.js', async (original) => ({
  ...await original<typeof import('../../../../storage/sqlite/index.js')>(),
  listConnectorApprovals,
}));

import { registerConnectorRoutes } from '../connectors.js';

function app() {
  const hono = new Hono();
  registerConnectorRoutes(hono, {
    service: { currentConfig: {} },
    strictRateLimitMiddleware: async (_c, next) => next(),
  } as never);
  return hono;
}

describe('connector routes', () => {
  it('matches the approvals collection before the connector id route', async () => {
    const response = await app().request('/api/connectors/approvals?status=pending');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, payload: { approvals: [] } });
    expect(listConnectorApprovals).toHaveBeenCalledWith({
      principalId: 'local-owner',
      sessionKey: undefined,
      status: 'pending',
      limit: 100,
    });
  });
});
