import { Hono } from 'hono';

import type { Config } from '../../../config/schema.js';
import { ConfigPersistenceError, persistConfigMutation } from '../../../config/config-mutation.js';
import type { ConnectorInstallInput } from '../../../connectors/types.js';
import {
  getStoreConnectorInstallPlan,
  installStoreConnector,
  listStoreConnectors,
} from '../../../capabilities/store-connector.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function optionalVersion(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const value = (body as Record<string, unknown>).version;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function registerCapabilityRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/capabilities/connectors', async (c) => {
    try {
      const page = Number(c.req.query('page') ?? '1');
      const pageSize = Number(c.req.query('pageSize') ?? '24');
      const result = await listStoreConnectors(service.currentConfig as Config, {
        q: c.req.query('q'),
        page: Number.isFinite(page) ? Math.max(1, page) : 1,
        pageSize: Number.isFinite(pageSize) ? Math.min(50, Math.max(1, pageSize)) : 24,
        sort: c.req.query('sort') === 'newest' ? 'newest' : 'downloads',
        category: c.req.query('category'),
      });
      return c.json({ ok: true, payload: result });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 502);
    }
  });

  authenticated.post('/api/capabilities/connectors/:name/install-plan', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const plan = await getStoreConnectorInstallPlan(
        service.currentConfig as Config,
        c.req.param('name'),
        optionalVersion(body),
      );
      return c.json({ ok: true, payload: { plan } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.post('/api/capabilities/connectors/:name/install', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const input: ConnectorInstallInput = body && typeof body === 'object' && !Array.isArray(body)
      ? body as ConnectorInstallInput
      : {};
    const config = service.currentConfig as Config;
    try {
      const { instance, plan } = await persistConfigMutation({
        config,
        mutate: () => installStoreConnector(config, c.req.param('name'), input, optionalVersion(body)),
        save: () => service.saveConfig(config),
      });
      return c.json({ ok: true, payload: { instance, plan } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, error instanceof ConfigPersistenceError ? 500 : 400);
    }
  });
}
