import type { Hono } from 'hono';

import { dirname } from 'node:path';

import { applyMigrations, detectMigrations } from '../../../migrations/runner.js';
import { resolveConfigPath } from '../../../config/paths.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerMigrationRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/migrations/status', async (c) => {
    const configPath = service.getHealth().configPath || process.env.XOPC_CONFIG_PATH || resolveConfigPath();
    const items = detectMigrations(configPath, { stateDir: dirname(configPath) });
    return c.json({
      ok: items.every((item) => item.status !== 'error'),
      payload: {
        pending: items.length,
        items,
      },
    });
  });

  authenticated.post('/api/migrations/apply', strictRateLimitMiddleware, async (c) => {
    const configPath = service.getHealth().configPath || process.env.XOPC_CONFIG_PATH || resolveConfigPath();
    const result = applyMigrations(configPath, { stateDir: dirname(configPath), mode: 'doctor-fix' });
    if (result.changed) {
      await service.reloadConfig();
    }
    return c.json({
      ok: result.items.every((item) => item.status !== 'error' && item.status !== 'conflict'),
      payload: result,
    });
  });
}
