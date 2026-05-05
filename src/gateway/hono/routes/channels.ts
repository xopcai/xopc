import { readFileSync } from 'node:fs';

import type { Hono } from 'hono';

import { writeTextAtomic } from '../../../infra/write-file-atomic.js';
import type { GatewayService } from '../../service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

type FeishuSetupDomain = 'feishu' | 'lark';

interface FeishuSetupSession {
  deviceCode: string;
  domain: FeishuSetupDomain;
  intervalSec: number;
  expireInSec: number;
  createdAt: number;
  phase: 'idle' | 'polling' | 'scanned' | 'done' | 'error';
  result?: {
    appId: string;
    appSecret: string;
    domain: FeishuSetupDomain;
    openId?: string;
  };
  error?: string;
}

const feishuSetupSessions = new Map<string, FeishuSetupSession>();

async function startFeishuSetupPolling(sessionKey: string, service: GatewayService): Promise<void> {
  const session = feishuSetupSessions.get(sessionKey);
  if (!session) return;

  const { pollAppRegistration } = await import(
    '../../../../extensions/feishu/src/auth/app-registration.js'
  );

  session.phase = 'polling';

  const outcome = await pollAppRegistration({
    deviceCode: session.deviceCode,
    intervalSec: session.intervalSec,
    expireInSec: session.expireInSec,
    initialDomain: session.domain,
  });

  if (outcome.status === 'success') {
    session.phase = 'done';
    session.result = outcome.result;
    try {
      const configPath = service.getHealth().configPath;
      const raw = readFileSync(configPath, 'utf8');
      const config = JSON.parse(raw) as {
        channels?: Record<string, unknown>;
      };
      const existingFeishu = (config.channels?.feishu ?? {}) as Record<string, unknown>;

      config.channels = {
        ...config.channels,
        feishu: {
          ...existingFeishu,
          enabled: true,
          appId: outcome.result.appId,
          appSecret: outcome.result.appSecret,
          domain: outcome.result.domain,
          connectionMode: (existingFeishu.connectionMode as string) || 'websocket',
        },
      };

      await writeTextAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`);
      await service.afterFeishuCredentialsPersisted();
    } catch {
      // Config write / reload failure is non-blocking; session still carries credentials for debugging.
    }
  } else {
    session.phase = 'error';
    session.error =
      outcome.status === 'access_denied'
        ? 'User denied authorization.'
        : outcome.status === 'expired'
          ? 'Session expired.'
          : outcome.status === 'timeout'
            ? 'Scan timed out.'
            : 'message' in outcome
              ? outcome.message
              : 'Unknown error.';
  }

  setTimeout(() => feishuSetupSessions.delete(sessionKey), 30_000);
}

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

  authenticated.post('/api/channels/feishu/setup/start', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const rawDomain =
      body && typeof body === 'object' && typeof (body as { domain?: unknown }).domain === 'string'
        ? (body as { domain: string }).domain.trim().toLowerCase()
        : '';
    const domain: FeishuSetupDomain = rawDomain === 'lark' ? 'lark' : 'feishu';

    const { initAppRegistration, beginAppRegistration } = await import(
      '../../../../extensions/feishu/src/auth/app-registration.js'
    );

    const supported = await initAppRegistration(domain);
    if (!supported) {
      return c.json(
        {
          ok: false,
          error: { code: 'FEISHU_SCAN_NOT_SUPPORTED', message: 'Scan-to-create is not available.' },
        },
        400,
      );
    }

    const begin = await beginAppRegistration(domain);

    const sessionKey = `feishu-setup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    feishuSetupSessions.set(sessionKey, {
      deviceCode: begin.deviceCode,
      domain,
      intervalSec: begin.intervalSec,
      expireInSec: begin.expireInSec,
      createdAt: Date.now(),
      phase: 'idle',
    });

    void startFeishuSetupPolling(sessionKey, service);

    return c.json({
      ok: true,
      payload: { sessionKey, qrUrl: begin.qrUrl },
    });
  });

  authenticated.get('/api/channels/feishu/setup/:sessionKey', async (c) => {
    const sessionKey = c.req.param('sessionKey')?.trim() ?? '';
    if (!sessionKey) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing sessionKey' } }, 400);
    }

    const session = feishuSetupSessions.get(sessionKey);
    if (!session) {
      return c.json({
        ok: true,
        payload: {
          status: { phase: 'unknown' as const, message: 'Session not found or expired.' },
        },
      });
    }

    if (session.phase === 'done' && session.result) {
      return c.json({
        ok: true,
        payload: {
          status: {
            phase: 'done' as const,
            ok: true,
            appId: session.result.appId,
            domain: session.result.domain,
            openId: session.result.openId,
          },
        },
      });
    }

    if (session.phase === 'error') {
      return c.json({
        ok: true,
        payload: {
          status: {
            phase: 'done' as const,
            ok: false,
            message: session.error ?? 'Setup failed.',
          },
        },
      });
    }

    return c.json({
      ok: true,
      payload: {
        status: { phase: 'polling' as const },
      },
    });
  });
}
