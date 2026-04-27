import type { Context } from 'hono';
import type { Hono } from 'hono';

import type { AuthenticatedRouteDeps } from './deps.js';

function buildStatusPayload(service: AuthenticatedRouteDeps['service']) {
  const health = service.getHealth();
  const rows = service.getChannelsStatus();
  const channels: Record<string, { status: string }> = {};
  for (const row of rows) {
    const status = !row.enabled ? 'disabled' : row.connected ? 'connected' : 'disconnected';
    channels[row.name] = { status };
  }
  return {
    status: health.status,
    version: health.version,
    channels,
    uptime: health.uptime,
  };
}

export function registerStatusRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  const handler = (c: Context) => c.json(buildStatusPayload(service));

  authenticated.get('/status', handler);
  authenticated.get('/api/status', handler);
}
