import type { Context } from 'hono';
import type { Hono } from 'hono';

import type { Config } from '../../../config/schema.js';
import { isSTTAvailable } from '../../../voice/stt/index.js';
import { mergeSttConfigFromAppConfig } from '../../../channels/attachments/voice-stt-webchat.js';
import { getDefaultModelSync, resolveModel } from '../../../providers/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function isRefineAvailable(config: Config | undefined): boolean {
  if (!config) return false;
  for (const candidate of [
    process.env.XOPC_VOICE_REFINE_MODEL?.trim(),
    'openai/gpt-5.6-luna',
    'google/gemini-3.5-flash',
  ]) {
    if (!candidate) continue;
    try {
      resolveModel(candidate);
      return true;
    } catch { /* next */ }
  }
  try {
    resolveModel(getDefaultModelSync(config));
    return true;
  } catch {
    return false;
  }
}

function buildStatusPayload(service: AuthenticatedRouteDeps['service']) {
  const health = service.getHealth();
  const rows = service.getChannelsStatus();
  const channels: Record<string, { status: string }> = {};
  for (const row of rows) {
    const status = !row.enabled ? 'disabled' : row.connected ? 'connected' : 'disconnected';
    channels[row.name] = { status };
  }

  const config = service.currentConfig as Config | undefined;
  const sttConfig = config
    ? mergeSttConfigFromAppConfig(config.tools?.media?.audio, config.tools?.media)
    : undefined;

  return {
    status: health.status,
    version: health.version,
    channels,
    uptime: health.uptime,
    voice: {
      sttAvailable: sttConfig ? isSTTAvailable(sttConfig) : false,
      refineAvailable: isRefineAvailable(config),
    },
  };
}

export function registerStatusRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  const handler = (c: Context) => c.json(buildStatusPayload(service));

  authenticated.get('/status', handler);
  authenticated.get('/api/status', handler);

  /**
   * POST /api/gateway/restart — respawn gateway process when supported (foreground `xopc gateway`).
   */
  authenticated.post('/api/gateway/restart', strictRateLimitMiddleware, (c) => {
    const result = service.triggerGatewayProcessRestart();
    if (!result.ok) {
      return c.json({ ok: false, error: result.mode, message: result.message ?? 'Restart failed' }, 400);
    }
    return c.json({ ok: true, payload: { mode: result.mode } });
  });
}
