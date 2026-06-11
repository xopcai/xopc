import type { Hono } from 'hono';

import type { Config } from '../../../config/schema.js';
import { getConnectorDefinition, listConnectorCatalog, listConnectorProviders } from '../../../connectors/catalog.js';
import { testConnectorInstance } from '../../../connectors/health.js';
import { installConnector, uninstallConnector } from '../../../connectors/install.js';
import { getConnectorInstance, listConnectorInstances } from '../../../connectors/instances.js';
import { startConnectorOAuth, completeConnectorOAuth } from '../../../connectors/oauth.js';
import { recordConnectorHealthUsage } from '../../../connectors/usage.js';
import type { ConnectorInstallInput } from '../../../connectors/types.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerConnectorRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  authenticated.get('/api/connectors/catalog', (c) => {
    return c.json({
      ok: true,
      payload: {
        connectors: listConnectorCatalog(),
        providers: listConnectorProviders().map((provider) => ({
          id: provider.id,
          displayName: provider.displayName,
        })),
      },
    });
  });

  authenticated.get('/api/connectors/installed', (c) => {
    const config = service.currentConfig as Config;
    return c.json({ ok: true, payload: { instances: listConnectorInstances(config) } });
  });

  authenticated.get('/api/connectors/:id', (c) => {
    const connectorId = c.req.param('id');
    const connector = getConnectorDefinition(connectorId);
    if (!connector) {
      return c.json({ ok: false, error: `Unknown connector: ${connectorId}` }, 404);
    }
    const config = service.currentConfig as Config;
    const instances = listConnectorInstances(config).filter((instance) => instance.connectorId === connectorId);
    return c.json({ ok: true, payload: { connector, instances } });
  });

  authenticated.post('/api/connectors/approvals/respond', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ ok: true, payload: { acknowledged: true, body } });
  });

  authenticated.post('/api/connectors/:id/oauth/start', strictRateLimitMiddleware, async (c) => {
    const connectorId = c.req.param('id');
    const connector = getConnectorDefinition(connectorId);
    if (!connector) {
      return c.json({ ok: false, error: `Unknown connector: ${connectorId}` }, 404);
    }
    try {
      const oauth = await startConnectorOAuth(connector);
      return c.json({ ok: true, payload: { oauth } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.post('/api/connectors/:id/oauth/complete', strictRateLimitMiddleware, async (c) => {
    const connectorId = c.req.param('id');
    const connector = getConnectorDefinition(connectorId);
    if (!connector) {
      return c.json({ ok: false, error: `Unknown connector: ${connectorId}` }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const deviceCode = body && typeof body === 'object' && !Array.isArray(body) && typeof body.deviceCode === 'string'
      ? body.deviceCode
      : '';
    try {
      const oauth = await completeConnectorOAuth(connector, { deviceCode });
      return c.json({ ok: true, payload: { oauth } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.post('/api/connectors/:id/install', strictRateLimitMiddleware, async (c) => {
    const connectorId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const input: ConnectorInstallInput = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const config = service.currentConfig as Config;
    try {
      const instance = await installConnector(config, connectorId, input);
      const saved = await service.saveConfig(config);
      if (!saved.saved) {
        return c.json({ ok: false, error: saved.error }, 500);
      }
      return c.json({ ok: true, payload: { instance } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.post('/api/connectors/:id/test', async (c) => {
    const instanceId = c.req.param('id');
    const config = service.currentConfig as Config;
    const instance = getConnectorInstance(config, instanceId);
    if (!instance) {
      return c.json({ ok: false, error: `Connector instance not found: ${instanceId}` }, 404);
    }
    try {
      const result = await testConnectorInstance(config, instance.materialized.serverId);
      recordConnectorHealthUsage(config, instance.instanceId, result);
      const saved = await service.saveConfig(config);
      if (!saved.saved) {
        return c.json({ ok: false, error: saved.error }, 500);
      }
      return c.json({ ok: true, payload: result });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 500);
    }
  });

  authenticated.delete('/api/connectors/:id', strictRateLimitMiddleware, async (c) => {
    const instanceId = c.req.param('id');
    const config = service.currentConfig as Config;
    try {
      const instance = uninstallConnector(config, instanceId);
      const saved = await service.saveConfig(config);
      if (!saved.saved) {
        return c.json({ ok: false, error: saved.error }, 500);
      }
      return c.json({ ok: true, payload: { instance } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });
}
