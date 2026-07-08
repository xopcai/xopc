import type { Hono } from 'hono';

import type { Config } from '../../../config/schema.js';
import { getConnectorDefinition, listConnectorCatalog, listConnectorProviders } from '../../../connectors/catalog.js';
import { executeComposioTool, getComposioToolkitScope, listComposioConnections, listComposioTools, setComposioToolkitScope, startComposioAuthorize, type ComposioScope } from '../../../connectors/composio.js';
import { appendComposioTriggerEvent, listComposioTriggerEvents } from '../../../connectors/composio-triggers.js';
import { previewConnectorDefinition, testConnectorInstance } from '../../../connectors/health.js';
import { installConnector, installConnectorDefinition, uninstallConnector, updateConnectorConfig } from '../../../connectors/install.js';
import { getConnectorInstance, listConnectorInstances } from '../../../connectors/instances.js';
import { setConnectorEnabled } from '../../../connectors/lifecycle.js';
import { startConnectorOAuth, completeConnectorOAuth } from '../../../connectors/oauth.js';
import { isConnectorRegistrySource, listConnectorRegistries, searchConnectorRegistries } from '../../../connectors/registries/search.js';
import { createConnectorSetupSecretRequest, submitConnectorSetupSecret } from '../../../connectors/setup-secrets.js';
import { recordConnectorHealthUsage } from '../../../connectors/usage.js';
import type { ConnectorDefinition, ConnectorInstallInput } from '../../../connectors/types.js';
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
        registries: listConnectorRegistries(),
      },
    });
  });

  authenticated.get('/api/connectors/installed', (c) => {
    const config = service.currentConfig as Config;
    return c.json({ ok: true, payload: { instances: listConnectorInstances(config) } });
  });

  authenticated.get('/api/connectors/registry/search', async (c) => {
    const query = c.req.query('q') ?? c.req.query('query') ?? '';
    const sourceParam = c.req.query('source') ?? 'all';
    const source = sourceParam !== 'all' && isConnectorRegistrySource(sourceParam) ? sourceParam : 'all';
    const page = Number(c.req.query('page') ?? '1');
    const pageSize = Number(c.req.query('pageSize') ?? '24');
    const browse = c.req.query('browse') === '1' || c.req.query('browse') === 'true';
    const results = await searchConnectorRegistries({ query, source, page, pageSize, browse });
    return c.json({ ok: true, payload: { results, connectors: results.flatMap((result) => result.connectors) } });
  });

  authenticated.post('/api/connectors/setup/request-secret', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const key = body && typeof body === 'object' && !Array.isArray(body) && typeof body.key === 'string'
      ? body.key.trim()
      : '';
    if (!key) {
      return c.json({ ok: false, error: 'Missing secret key.' }, 400);
    }
    const label = body && typeof body === 'object' && !Array.isArray(body) && typeof body.label === 'string'
      ? body.label
      : undefined;
    return c.json({ ok: true, payload: { request: createConnectorSetupSecretRequest({ key, label }) } });
  });

  authenticated.post('/api/connectors/setup/submit-secret', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ref = body && typeof body === 'object' && !Array.isArray(body) && typeof body.ref === 'string'
      ? body.ref
      : '';
    const value = body && typeof body === 'object' && !Array.isArray(body) && typeof body.value === 'string'
      ? body.value
      : '';
    const accepted = submitConnectorSetupSecret(ref, value);
    return c.json({ ok: accepted, payload: { accepted }, error: accepted ? undefined : 'Unknown, expired, or empty secret.' }, accepted ? 200 : 400);
  });

  authenticated.get('/api/connectors/composio/connections', async (c) => {
    try {
      return c.json({ ok: true, payload: { connections: await listComposioConnections() } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.post('/api/connectors/composio/:toolkit/authorize', strictRateLimitMiddleware, async (c) => {
    try {
      const toolkit = c.req.param('toolkit');
      return c.json({ ok: true, payload: { oauth: await startComposioAuthorize(toolkit) } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.get('/api/connectors/composio/:toolkit/tools', async (c) => {
    try {
      const toolkit = c.req.param('toolkit');
      return c.json({ ok: true, payload: { tools: await listComposioTools(toolkit, service.currentConfig as Config) } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.get('/api/connectors/composio/:toolkit/scope', async (c) => {
    const toolkit = c.req.param('toolkit');
    return c.json({ ok: true, payload: { toolkit, scope: getComposioToolkitScope(service.currentConfig as Config, toolkit) } });
  });

  authenticated.post('/api/connectors/composio/:toolkit/scope', strictRateLimitMiddleware, async (c) => {
    const toolkit = c.req.param('toolkit');
    const body = await c.req.json().catch(() => ({}));
    const scope = body && typeof body === 'object' && !Array.isArray(body) && typeof body.scope === 'string'
      ? body.scope
      : '';
    if (scope !== 'read' && scope !== 'write' && scope !== 'admin') {
      return c.json({ ok: false, error: 'Scope must be read, write, or admin.' }, 400);
    }
    const config = service.currentConfig as Config;
    try {
      setComposioToolkitScope(config, toolkit, scope as ComposioScope);
      const saved = await service.saveConfig(config);
      if (!saved.saved) return c.json({ ok: false, error: saved.error }, 500);
      return c.json({ ok: true, payload: { toolkit, scope } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.post('/api/connectors/composio/tools/:slug/execute', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const slug = c.req.param('slug');
      const args = body && typeof body === 'object' && !Array.isArray(body) ? body.arguments : undefined;
      return c.json({ ok: true, payload: { result: await executeComposioTool({ slug, arguments: args, config: service.currentConfig as Config }) } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.post('/api/connectors/composio/triggers', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const event = await appendComposioTriggerEvent(service.currentConfig as Config, body);
      return c.json({ ok: true, payload: { event } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.get('/api/connectors/composio/triggers', async (c) => {
    const limit = Number(c.req.query('limit') ?? '50');
    try {
      const events = await listComposioTriggerEvents(service.currentConfig as Config, limit);
      return c.json({ ok: true, payload: { events } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
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

  authenticated.post('/api/connectors/preview', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const definition = body && typeof body === 'object' && !Array.isArray(body) && body.definition && typeof body.definition === 'object' && !Array.isArray(body.definition)
      ? body.definition as ConnectorDefinition
      : undefined;
    if (!definition) {
      return c.json({ ok: false, error: 'Missing connector definition.' }, 400);
    }
    const input: ConnectorInstallInput = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    try {
      const preview = await previewConnectorDefinition(service.currentConfig as Config, definition, input);
      return c.json({ ok: true, payload: { preview } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
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
    const registryDefinition = body && typeof body === 'object' && !Array.isArray(body) && body.definition && typeof body.definition === 'object' && !Array.isArray(body.definition)
      ? body.definition as ConnectorDefinition
      : undefined;
    const config = service.currentConfig as Config;
    try {
      const instance = registryDefinition?.id === connectorId
        ? await installConnectorDefinition(config, registryDefinition, input)
        : await installConnector(config, connectorId, input);
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
    if (instance.materialized.type !== 'mcp') {
      return c.json({ ok: false, error: `Connector type "${instance.materialized.type}" does not support MCP health checks.` }, 400);
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

  authenticated.post('/api/connectors/:id/config', strictRateLimitMiddleware, async (c) => {
    const instanceId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const input: ConnectorInstallInput = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const config = service.currentConfig as Config;
    try {
      const instance = updateConnectorConfig(config, instanceId, input);
      const saved = await service.saveConfig(config);
      if (!saved.saved) {
        return c.json({ ok: false, error: saved.error }, 500);
      }
      return c.json({ ok: true, payload: { instance } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.post('/api/connectors/:id/enable', strictRateLimitMiddleware, async (c) => {
    const instanceId = c.req.param('id');
    const config = service.currentConfig as Config;
    try {
      const instance = setConnectorEnabled(config, instanceId, true);
      const saved = await service.saveConfig(config);
      if (!saved.saved) {
        return c.json({ ok: false, error: saved.error }, 500);
      }
      return c.json({ ok: true, payload: { instance } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.post('/api/connectors/:id/disable', strictRateLimitMiddleware, async (c) => {
    const instanceId = c.req.param('id');
    const config = service.currentConfig as Config;
    try {
      const instance = setConnectorEnabled(config, instanceId, false);
      const saved = await service.saveConfig(config);
      if (!saved.saved) {
        return c.json({ ok: false, error: saved.error }, 500);
      }
      return c.json({ ok: true, payload: { instance } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
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
