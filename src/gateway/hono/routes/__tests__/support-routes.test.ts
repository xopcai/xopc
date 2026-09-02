import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { collectSupportReport } = vi.hoisted(() => ({
  collectSupportReport: vi.fn(async (input: { problem: string }) => ({
    schemaVersion: 1 as const,
    title: `[Bug] ${input.problem}`,
    markdown: input.problem,
  })),
}));

vi.mock('../../../../support/collect-support-report.js', () => ({ collectSupportReport }));

import { registerSupportRoutes } from '../support.js';

function createApp() {
  const app = new Hono();
  registerSupportRoutes(app, {
    service: {
      getHealth: () => ({ status: 'ok', version: '1.2.3', uptime: 42 }),
      getChannelsStatus: () => [{ name: 'telegram', enabled: true, connected: false }],
    },
    strictRateLimitMiddleware: async (_c, next) => next(),
  } as never);
  return app;
}

describe('support report routes', () => {
  beforeEach(() => {
    collectSupportReport.mockClear();
  });

  it('collects a report with a safe runtime snapshot', async () => {
    const response = await createApp().request('/api/support/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: 'Telegram does not reply' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      ok: true,
      report: expect.objectContaining({ title: '[Bug] Telegram does not reply' }),
      investigationPrompt: expect.stringContaining('main agent'),
    }));
    expect(collectSupportReport).toHaveBeenCalledWith(
      { problem: 'Telegram does not reply' },
      { runtime: {
        gatewayStatus: 'ok',
        gatewayVersion: '1.2.3',
        gatewayUptimeMs: 42,
        channels: { telegram: 'disconnected' },
      } },
    );
  });

  it('rejects empty or unknown input fields', async () => {
    const response = await createApp().request('/api/support/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: '', rawConfig: 'secret' }),
    });

    expect(response.status).toBe(400);
    expect(collectSupportReport).toHaveBeenCalledTimes(0);
  });
});
