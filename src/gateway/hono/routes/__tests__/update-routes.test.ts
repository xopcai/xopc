import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runGatewayUpdateCheck: vi.fn(),
}));

vi.mock('../../../../infra/update-startup.js', () => ({
  getUpdateAvailable: () => null,
  runGatewayUpdateCheck: mocks.runGatewayUpdateCheck,
}));

vi.mock('../../../../config/index.js', () => ({
  loadConfig: () => ({}),
}));

import { registerUpdateRoutes } from '../update.js';

describe('update routes', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns a check failure instead of reporting the gateway as up to date', async () => {
    mocks.runGatewayUpdateCheck.mockResolvedValue({ ok: false, error: 'HTTP 503' });
    const app = new Hono();
    registerUpdateRoutes(app, {
      strictRateLimitMiddleware: async (_c, next) => next(),
      service: {
        emit: vi.fn(),
        getHealth: () => ({ configPath: '/unused/xopc.json' }),
      },
    } as never);

    const response = await app.request('/api/update/check', { method: 'POST' });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'update-check-failed',
      message: 'Could not check npm for updates: HTTP 503',
    });
  });
});
