import { readFileSync } from 'node:fs';

import type { Hono } from 'hono';

import { mergeDistinctSenderIds } from '../../../channels/pairing/index.js';
import type { PairingCliChannel } from '../../../channels/pairing/pairing-channel.js';
import {
  approveChannelPairing,
  approveChannelPairingBySender,
  dismissChannelPairingPending,
  listChannelPairingState,
  listChannelPairingSummary,
  revokeChannelPairingPaired,
} from '../../../channels/pairing/pairing-service.js';
import type { Config } from '../../../config/index.js';
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
      const dmPolicy =
        typeof existingFeishu.dmPolicy === 'string' && existingFeishu.dmPolicy.trim()
          ? existingFeishu.dmPolicy
          : 'open';
      const preseedOpenId = outcome.result.openId?.trim();
      const allowFrom = mergeDistinctSenderIds(existingFeishu.allowFrom, preseedOpenId ? [preseedOpenId] : []);

      config.channels = {
        ...config.channels,
        feishu: {
          ...existingFeishu,
          enabled: true,
          appId: outcome.result.appId,
          appSecret: outcome.result.appSecret,
          domain: outcome.result.domain,
          connectionMode: (existingFeishu.connectionMode as string) || 'websocket',
          dmPolicy,
          allowFrom,
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

const PAIRING_CHANNELS = new Set<PairingCliChannel>(['telegram', 'feishu', 'weixin']);

function parsePairingChannel(raw: string | undefined): PairingCliChannel | null {
  const ch = (raw ?? '').trim().toLowerCase() as PairingCliChannel;
  return PAIRING_CHANNELS.has(ch) ? ch : null;
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

  authenticated.get('/api/channels/pairing', (c) => {
    const channel = parsePairingChannel(c.req.query('channel'));
    if (!channel) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Query param channel is required (telegram|feishu|weixin).' } },
        400,
      );
    }
    const accountRaw = c.req.query('account')?.trim();
    const accountId = accountRaw || 'default';
    const config = service.currentConfig as Config | undefined;
    const state = listChannelPairingState({ channel, accountId, config });
    return c.json({ ok: true, payload: state });
  });

  authenticated.post('/api/channels/pairing/approve', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const channel =
      body && typeof body === 'object' && typeof (body as { channel?: unknown }).channel === 'string'
        ? parsePairingChannel((body as { channel: string }).channel)
        : null;
    if (!channel) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Body field channel is required (telegram|feishu|weixin).' } },
        400,
      );
    }
    const accountRaw =
      body && typeof body === 'object' && typeof (body as { accountId?: unknown }).accountId === 'string'
        ? (body as { accountId: string }).accountId.trim()
        : 'default';
    const code =
      body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string'
        ? (body as { code: string }).code.trim()
        : '';
    const result = approveChannelPairing({ channel, accountId: accountRaw || 'default', code });
    if (result.ok === false) {
      return c.json(
        { ok: false, error: { code: 'PAIRING_INVALID', message: result.error } },
        400,
      );
    }
    return c.json({
      ok: true,
      payload: { senderId: result.senderId, alreadyPaired: result.alreadyPaired },
    });
  });

  authenticated.get('/api/channels/pairing/summary', (c) => {
    const config = service.currentConfig as Config | undefined;
    const summary = listChannelPairingSummary(config);
    return c.json({ ok: true, payload: { summary } });
  });

  authenticated.post('/api/channels/pairing/approve-sender', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const channel =
      body && typeof body === 'object' && typeof (body as { channel?: unknown }).channel === 'string'
        ? parsePairingChannel((body as { channel: string }).channel)
        : null;
    if (!channel) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Body field channel is required (telegram|feishu|weixin).' } },
        400,
      );
    }
    const accountRaw =
      body && typeof body === 'object' && typeof (body as { accountId?: unknown }).accountId === 'string'
        ? (body as { accountId: string }).accountId.trim()
        : 'default';
    const senderId =
      body && typeof body === 'object' && typeof (body as { senderId?: unknown }).senderId === 'string'
        ? (body as { senderId: string }).senderId.trim()
        : '';
    const result = approveChannelPairingBySender({
      channel,
      accountId: accountRaw || 'default',
      senderId,
    });
    if (result.ok === false) {
      return c.json(
        { ok: false, error: { code: 'PAIRING_INVALID', message: result.error } },
        400,
      );
    }
    return c.json({
      ok: true,
      payload: { senderId: result.senderId, alreadyPaired: result.alreadyPaired },
    });
  });

  authenticated.delete('/api/channels/pairing/paired', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const channel =
      body && typeof body === 'object' && typeof (body as { channel?: unknown }).channel === 'string'
        ? parsePairingChannel((body as { channel: string }).channel)
        : null;
    if (!channel) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Body field channel is required (telegram|feishu|weixin).' } },
        400,
      );
    }
    const accountRaw =
      body && typeof body === 'object' && typeof (body as { accountId?: unknown }).accountId === 'string'
        ? (body as { accountId: string }).accountId.trim()
        : 'default';
    const senderId =
      body && typeof body === 'object' && typeof (body as { senderId?: unknown }).senderId === 'string'
        ? (body as { senderId: string }).senderId.trim()
        : '';
    const result = revokeChannelPairingPaired({
      channel,
      accountId: accountRaw || 'default',
      senderId,
    });
    if (result.ok === false) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: result.error } },
        400,
      );
    }
    return c.json({ ok: true, payload: { changed: result.changed } });
  });

  authenticated.delete('/api/channels/pairing/pending', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const channel =
      body && typeof body === 'object' && typeof (body as { channel?: unknown }).channel === 'string'
        ? parsePairingChannel((body as { channel: string }).channel)
        : null;
    if (!channel) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Body field channel is required (telegram|feishu|weixin).' } },
        400,
      );
    }
    const accountRaw =
      body && typeof body === 'object' && typeof (body as { accountId?: unknown }).accountId === 'string'
        ? (body as { accountId: string }).accountId.trim()
        : 'default';
    const senderId =
      body && typeof body === 'object' && typeof (body as { senderId?: unknown }).senderId === 'string'
        ? (body as { senderId: string }).senderId.trim()
        : '';
    const result = dismissChannelPairingPending({
      channel,
      accountId: accountRaw || 'default',
      senderId,
    });
    if (result.ok === false) {
      return c.json(
        { ok: false, error: { code: 'PAIRING_INVALID', message: result.error } },
        400,
      );
    }
    return c.json({ ok: true, payload: { senderId: result.senderId } });
  });
}
