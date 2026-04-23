import type { Hono } from 'hono';

import { loadConfig } from '../../../config/index.js';
import { getUpdateAvailable, runGatewayUpdateCheck } from '../../../infra/update-startup.js';
import { PACKAGE_VERSION } from '../../../package-version.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerUpdateRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { strictRateLimitMiddleware, service } = deps;

  /**
   * GET /api/update/status
   */
  authenticated.get('/api/update/status', (c) => {
    const update = getUpdateAvailable();
    return c.json({
      ok: true,
      payload: {
        currentVersion: PACKAGE_VERSION,
        updateAvailable: update !== null,
        latestVersion: update?.latestVersion ?? null,
        channel: update?.channel ?? null,
      },
    });
  });

  /**
   * POST /api/update/check
   */
  authenticated.post('/api/update/check', strictRateLimitMiddleware, async (c) => {
    const config = loadConfig(service.getHealth().configPath);
    await runGatewayUpdateCheck({
      config,
      force: true,
      onUpdateAvailableChange: (update) => {
        service.emit('update.available', update);
      },
    });
    const result = getUpdateAvailable();
    return c.json({
      ok: true,
      payload: {
        currentVersion: PACKAGE_VERSION,
        updateAvailable: result !== null,
        latestVersion: result?.latestVersion ?? null,
        channel: result?.channel ?? null,
      },
    });
  });
}
