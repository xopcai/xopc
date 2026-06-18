import type { Hono } from 'hono';

import {
  approveChannelPairing,
  approveChannelPairingBySender,
  dismissChannelPairingPending,
  listChannelPairingState,
  listChannelPairingSummary,
  revokeChannelPairingPaired,
} from '../../../channels/pairing/pairing-service.js';
import {
  buildChannelCatalogForConfig,
  buildChannelCatalogFromSnapshot,
  isChannelConfigured,
} from '../../../channels/catalog/channel-catalog-service.js';
import type { Config } from '../../../config/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import type { ChannelRuntimeActionPayload } from '../../../channels/plugins/types.adapters.js';

function channelIdParam(raw: string | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

function accountIdFromQuery(raw: string | undefined): string {
  return raw?.trim() || 'default';
}

function actionPayloadChangedConfig(payload: ChannelRuntimeActionPayload | undefined): boolean {
  return Boolean(payload && 'configChanged' in payload && payload.configChanged === true);
}

function localeFromRequest(c: { req: { query(name: string): string | undefined; header(name: string): string | undefined } }): string | undefined {
  return c.req.query('locale') ?? c.req.header('X-XOPC-Locale') ?? c.req.header('Accept-Language')?.split(',')[0];
}

export function registerChannelRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/channels/catalog', (c) => {
    const snapshot = service.getExtensionLoader()?.getManifestSnapshot();
    const locale = localeFromRequest(c);
    const catalog = snapshot
      ? buildChannelCatalogFromSnapshot(snapshot, { locale })
      : buildChannelCatalogForConfig(service.currentConfig, { locale });
    const channelsCfg = service.currentConfig.channels as Record<string, { enabled?: boolean } | undefined> | undefined;
    const running = new Set(service.getRunningChannelIds());
    return c.json({
      ok: true,
      payload: {
        channels: catalog.entries.map((entry) => ({
          ...entry,
          enabled: channelsCfg?.[entry.id]?.enabled === true,
          configured: isChannelConfigured(service.currentConfig, entry.id),
          runtime: running.has(entry.id) ? 'loaded' : 'missing',
        })),
      },
    });
  });

  authenticated.get('/api/channels/status', (c) => {
    const channels = service.getChannelsStatus();
    return c.json({ ok: true, payload: { channels } });
  });

  authenticated.get('/api/channels/meta', (c) => {
    const channels = service.getChannelsHubMeta();
    return c.json({ ok: true, payload: { channels } });
  });

  authenticated.get('/api/channels/:channelId/config', (c) => {
    const channel = channelIdParam(c.req.param('channelId'));
    if (!channel) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing channel id' } }, 400);
    }
    const plugin = service.getChannelRuntimePlugin(channel);
    const value =
      plugin?.configSurface?.buildConfigSurface(service.currentConfig) ??
      (service.currentConfig.channels as Record<string, unknown> | undefined)?.[channel] ??
      {};
    return c.json({ ok: true, payload: { config: value } });
  });

  authenticated.post('/api/channels/:channelId/actions/:actionId', strictRateLimitMiddleware, async (c) => {
    const channel = channelIdParam(c.req.param('channelId'));
    const action = c.req.param('actionId')?.trim() ?? '';
    if (!channel || !action) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing channel/action id' } }, 400);
    }
    const plugin = await service.ensureChannelRuntimePlugin(channel);
    if (!plugin) {
      return c.json({ ok: false, error: { code: 'CHANNEL_RUNTIME_MISSING', message: 'Channel runtime is not loaded' } }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const accountId =
      body && typeof body === 'object' && typeof (body as { accountId?: unknown }).accountId === 'string'
        ? (body as { accountId: string }).accountId.trim()
        : undefined;
    const input = body && typeof body === 'object' ? (body as { input?: unknown }).input : undefined;

    if (action === 'doctor.run' && plugin.doctor) {
      const checks = await plugin.doctor.check({ cfg: service.currentConfig, locale: localeFromRequest(c) });
      return c.json({ ok: true, payload: { type: 'diagnostics', checks } });
    }

    if (plugin.runtimeActions) {
      const result = await plugin.runtimeActions.runAction({
        cfg: service.currentConfig,
        locale: localeFromRequest(c),
        actionId: action,
        accountId,
        input,
      });
      if (!result.ok) {
        return c.json({ ok: false, error: { code: 'CHANNEL_ACTION_FAILED', message: result.message ?? 'Channel action failed' } }, 400);
      }
      if (actionPayloadChangedConfig(result.payload)) {
        await service.reloadConfig();
      }
      return c.json({ ok: true, payload: result.payload ?? {} });
    }

    return c.json(
      {
        ok: false,
        error: {
          code: 'ACTION_NOT_IMPLEMENTED',
          message: `Channel action "${channel}.${action}" is not implemented by the runtime adapter.`,
        },
      },
      501,
    );
  });

  authenticated.get('/api/channels/:channelId/pairing', (c) => {
    const channel = channelIdParam(c.req.param('channelId'));
    if (!channel) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing channel id' } }, 400);
    }
    const accountId = accountIdFromQuery(c.req.query('account'));
    const config = service.currentConfig as Config | undefined;
    const state = listChannelPairingState({ channel, accountId, config });
    return c.json({ ok: true, payload: state });
  });

  authenticated.get('/api/channels/pairing/summary', (c) => {
    const config = service.currentConfig as Config | undefined;
    const summary = listChannelPairingSummary(config);
    return c.json({ ok: true, payload: { summary } });
  });

  authenticated.post('/api/channels/:channelId/pairing/approve', strictRateLimitMiddleware, async (c) => {
    const channel = channelIdParam(c.req.param('channelId'));
    const body = await c.req.json().catch(() => ({}));
    const accountId =
      body && typeof body === 'object' && typeof (body as { accountId?: unknown }).accountId === 'string'
        ? (body as { accountId: string }).accountId.trim()
        : 'default';
    const code =
      body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string'
        ? (body as { code: string }).code.trim()
        : '';
    const result = approveChannelPairing({ channel, accountId, code });
    if (result.ok === false) {
      return c.json({ ok: false, error: { code: 'PAIRING_INVALID', message: result.error } }, 400);
    }
    return c.json({ ok: true, payload: { senderId: result.senderId, alreadyPaired: result.alreadyPaired } });
  });

  authenticated.post('/api/channels/:channelId/pairing/approve-sender', strictRateLimitMiddleware, async (c) => {
    const channel = channelIdParam(c.req.param('channelId'));
    const body = await c.req.json().catch(() => ({}));
    const accountId =
      body && typeof body === 'object' && typeof (body as { accountId?: unknown }).accountId === 'string'
        ? (body as { accountId: string }).accountId.trim()
        : 'default';
    const senderId =
      body && typeof body === 'object' && typeof (body as { senderId?: unknown }).senderId === 'string'
        ? (body as { senderId: string }).senderId.trim()
        : '';
    const result = approveChannelPairingBySender({ channel, accountId, senderId });
    if (result.ok === false) {
      return c.json({ ok: false, error: { code: 'PAIRING_INVALID', message: result.error } }, 400);
    }
    return c.json({ ok: true, payload: { senderId: result.senderId, alreadyPaired: result.alreadyPaired } });
  });

  authenticated.delete('/api/channels/:channelId/pairing/paired', strictRateLimitMiddleware, async (c) => {
    const channel = channelIdParam(c.req.param('channelId'));
    const body = await c.req.json().catch(() => ({}));
    const accountId =
      body && typeof body === 'object' && typeof (body as { accountId?: unknown }).accountId === 'string'
        ? (body as { accountId: string }).accountId.trim()
        : 'default';
    const senderId =
      body && typeof body === 'object' && typeof (body as { senderId?: unknown }).senderId === 'string'
        ? (body as { senderId: string }).senderId.trim()
        : '';
    const result = revokeChannelPairingPaired({ channel, accountId, senderId });
    if (result.ok === false) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: result.error } }, 400);
    }
    return c.json({ ok: true, payload: { changed: result.changed } });
  });

  authenticated.delete('/api/channels/:channelId/pairing/pending', strictRateLimitMiddleware, async (c) => {
    const channel = channelIdParam(c.req.param('channelId'));
    const body = await c.req.json().catch(() => ({}));
    const accountId =
      body && typeof body === 'object' && typeof (body as { accountId?: unknown }).accountId === 'string'
        ? (body as { accountId: string }).accountId.trim()
        : 'default';
    const senderId =
      body && typeof body === 'object' && typeof (body as { senderId?: unknown }).senderId === 'string'
        ? (body as { senderId: string }).senderId.trim()
        : '';
    const result = dismissChannelPairingPending({ channel, accountId, senderId });
    if (result.ok === false) {
      return c.json({ ok: false, error: { code: 'PAIRING_INVALID', message: result.error } }, 400);
    }
    return c.json({ ok: true, payload: { senderId: result.senderId } });
  });

  authenticated.get('/api/channels/:channelId/doctor', async (c) => {
    const channel = channelIdParam(c.req.param('channelId'));
    const plugin = service.getChannelRuntimePlugin(channel);
    if (!plugin?.doctor) {
      return c.json({ ok: true, payload: { checks: [] } });
    }
    const checks = await plugin.doctor.check({ cfg: service.currentConfig });
    return c.json({ ok: true, payload: { checks } });
  });

  authenticated.post('/api/channels/:channelId/restart', strictRateLimitMiddleware, async (c) => {
    const channel = channelIdParam(c.req.param('channelId'));
    await service.restartChannel(channel);
    return c.json({ ok: true, payload: { restarted: true } });
  });
}
