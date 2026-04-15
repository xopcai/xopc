import type { Hono } from 'hono';

import type { AuthenticatedRouteDeps } from './deps.js';

export function registerChannelRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/channels/status', (c) => {
    const channels = service.getChannelsStatus();
    return c.json({ ok: true, payload: { channels } });
  });

  authenticated.post('/api/channels/weixin/login/start', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const account =
      body && typeof body === 'object' && typeof (body as { account?: unknown }).account === 'string'
        ? (body as { account: string }).account.trim() || undefined
        : undefined;
    const rawTimeout =
      body && typeof body === 'object' ? (body as { timeoutMs?: unknown }).timeoutMs : undefined;
    const timeoutMs =
      typeof rawTimeout === 'number' && Number.isFinite(rawTimeout) ? Math.max(60_000, rawTimeout) : undefined;

    const { startWeixinGatewayQrLogin } = await import('../../../channels/weixin/index.js');
    const result = await startWeixinGatewayQrLogin({
      configPath: service.getHealth().configPath,
      account,
      timeoutMs,
      onPersisted: async (r) => {
        if (r.ok) {
          await service.afterWeixinCredentialsPersisted();
        }
      },
    });

    if (result.ok === false) {
      return c.json(
        { ok: false, error: { code: 'WEIXIN_LOGIN_FAILED', message: result.message } },
        400,
      );
    }
    return c.json({
      ok: true,
      payload: { sessionKey: result.sessionKey, qrcodeUrl: result.qrcodeUrl },
    });
  });

  authenticated.get('/api/channels/weixin/login/:sessionKey', async (c) => {
    const sessionKey = c.req.param('sessionKey')?.trim() ?? '';
    if (!sessionKey) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing sessionKey' } }, 400);
    }
    const { getWeixinGatewayQrLoginStatus } = await import('../../../channels/weixin/index.js');
    const status = getWeixinGatewayQrLoginStatus(sessionKey);
    return c.json({ ok: true, payload: { status } });
  });
}
