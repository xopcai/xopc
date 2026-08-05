import type { Hono } from 'hono';

import { resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import type { Config } from '../../../config/schema.js';
import { buildConnectedPeopleGraph } from '../../../knowledge/index.js';
import { startConnectorAuthorization } from '../../../connectors/auth-provider-registry.js';
import { getConnectorDefinition, listConnectorCatalog, listConnectorProviders } from '../../../connectors/catalog.js';
import { listComposioConnectorCatalog } from '../../../connectors/composio-catalog.js';
import { composioLogoResponse } from '../../../connectors/composio-logo.js';
import {
  executeComposioTool,
  configureComposioApiKey,
  getComposioInstallationPolicy,
  getComposioToolkitScope,
  listComposioConnections,
  inspectComposioConnectorHealth,
  listComposioTools,
  refreshComposioConnection,
  revokeComposioConnection,
  setComposioToolkitScope,
  updateComposioConnection,
  updateComposioInstallationPolicy,
  type ComposioScope,
} from '../../../connectors/composio.js';
import { resolveComposioApiKey } from '../../../connectors/composio-sessions.js';
import { appendComposioTriggerEvent, listComposioTriggerEvents } from '../../../connectors/composio-triggers.js';
import { previewConnectorDefinition, testConnectorInstance } from '../../../connectors/health.js';
import { installConnector, installConnectorDefinition, uninstallConnector, updateConnectorConfig } from '../../../connectors/install.js';
import { getConnectorInstance, listConnectorInstances } from '../../../connectors/instances.js';
import { setConnectorEnabled } from '../../../connectors/lifecycle.js';
import { projectComposioConnectionStatus } from '../../../connectors/runtime-status.js';
import { createConnectorSetupSecretRequest, submitConnectorSetupSecret } from '../../../connectors/setup-secrets.js';
import { ingestLocalFolderSource } from '../../../connectors/connected-source-ingestion.js';
import { recordConnectorHealthUsage } from '../../../connectors/usage.js';
import type { ConnectorDefinition, ConnectorInstallInput } from '../../../connectors/types.js';
import {
  decideConnectorApproval,
  getConnectorApproval,
  listConnectorConnections,
  listConnectorApprovals,
  listConnectorLearningJobs,
} from '../../../storage/sqlite/index.js';
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
    const instances = listConnectorInstances(config);
    const connections = listConnectorConnections({ principalId: 'local-owner' });
    return c.json({
      ok: true,
      payload: { instances: projectComposioConnectionStatus(instances, connections) },
    });
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

  authenticated.get('/api/connectors/learning', (c) => {
    return c.json({ ok: true, payload: { jobs: listConnectorLearningJobs({ limit: 100 }) } });
  });

  authenticated.post('/api/connectors/composio/connections/:id/learning', strictRateLimitMiddleware, async (c) => {
    try {
      await listComposioConnections();
      const config = service.currentConfig as Config;
      if (!config.userContext.memory.sources.includes('connectedSources')) {
        config.userContext.memory.sources = [...config.userContext.memory.sources, 'connectedSources'];
        const saved = await service.saveConfig(config);
        if (!saved.saved) return c.json({ ok: false, error: saved.error }, 500);
      }
      const job = service.requestConnectorLearning(c.req.param('id'), { reason: 'manual' });
      if (!job) return c.json({ ok: false, error: 'The connection is not active or does not support learning.' }, 409);
      return c.json({ ok: true, payload: { job } }, 202);
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.post('/api/connectors/composio/connections/:id/learning/pause', strictRateLimitMiddleware, (c) => {
    const changed = service.setConnectorLearningPaused(c.req.param('id'), true);
    return c.json({ ok: true, payload: { changed } });
  });

  authenticated.post('/api/connectors/composio/connections/:id/learning/resume', strictRateLimitMiddleware, (c) => {
    const changed = service.setConnectorLearningPaused(c.req.param('id'), false);
    return c.json({ ok: true, payload: { changed } });
  });

  authenticated.patch('/api/connectors/composio/connections/:id', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const row = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    try {
      const connection = updateComposioConnection(c.req.param('id'), {
        alias: typeof row.alias === 'string' ? row.alias : undefined,
        isDefault: typeof row.isDefault === 'boolean' ? row.isDefault : undefined,
      });
      return c.json({ ok: true, payload: { connection } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 404);
    }
  });

  authenticated.post('/api/connectors/composio/connections/:id/refresh', strictRateLimitMiddleware, async (c) => {
    try {
      await refreshComposioConnection(c.req.param('id'));
      return c.json({ ok: true, payload: { refreshed: true } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.delete('/api/connectors/composio/connections/:id', strictRateLimitMiddleware, async (c) => {
    try {
      const connectionId = c.req.param('id');
      await revokeComposioConnection(connectionId);
      service.setConnectorLearningPaused(connectionId, true);
      return c.json({ ok: true, payload: { revoked: true } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.get('/api/connectors/composio/catalog', async (c) => {
    try {
      const refresh = c.req.query('refresh') === '1' || c.req.query('refresh') === 'true';
      const verificationParam = c.req.query('verification');
      const verification = verificationParam === 'verified' || verificationParam === 'experimental'
        ? verificationParam
        : 'all';
      return c.json({
        ok: true,
        payload: await listComposioConnectorCatalog({
          refresh,
          verification,
          query: c.req.query('q') ?? '',
          page: Number(c.req.query('page') ?? '1'),
          pageSize: Number(c.req.query('pageSize') ?? '24'),
        }),
      });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.get('/api/connectors/composio/:toolkit/logo', async (c) => {
    try {
      return await composioLogoResponse(c.req.param('toolkit'));
    } catch {
      return c.json({ ok: false, error: 'Connector logo is unavailable.' }, 404);
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
      if (event.toolkit) service.requestConnectorLearningForToolkit(event.toolkit);
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

  authenticated.get('/api/connectors/people', (c) => {
    const query = c.req.query('q') ?? '';
    const limit = Number(c.req.query('limit') ?? '100');
    return c.json({ ok: true, payload: buildConnectedPeopleGraph({ query, limit }) });
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

  authenticated.get('/api/connectors/composio/:toolkit/health', async (c) => {
    const health = await inspectComposioConnectorHealth(c.req.param('toolkit'));
    return c.json({ ok: health.status !== 'degraded', payload: { health } });
  });

  authenticated.get('/api/connectors/composio/:toolkit/policy', (c) => {
    const config = service.currentConfig as Config;
    try {
      const policy = getComposioInstallationPolicy(config, c.req.param('toolkit'));
      const agents = config.agents.list.filter((agent) => agent.enabled).map((agent) => ({
        id: agent.id,
        name: agent.identity?.name ?? agent.id,
      }));
      return c.json({ ok: true, payload: { policy, agents } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.patch('/api/connectors/composio/:toolkit/policy', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const row = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const rawConfirmationPolicy = row.confirmationPolicy;
    if (rawConfirmationPolicy !== undefined && rawConfirmationPolicy !== 'never' && rawConfirmationPolicy !== 'writes' && rawConfirmationPolicy !== 'always') {
      return c.json({ ok: false, error: 'Invalid confirmation policy.' }, 400);
    }
    const confirmationPolicy = rawConfirmationPolicy === 'never' || rawConfirmationPolicy === 'writes' || rawConfirmationPolicy === 'always'
      ? rawConfirmationPolicy
      : undefined;
    const allowedAgentIds = Array.isArray(row.allowedAgentIds)
      ? [...new Set(row.allowedAgentIds.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean))]
      : undefined;
    const selectedConnectionIds = Array.isArray(row.selectedConnectionIds)
      ? [...new Set(row.selectedConnectionIds.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean))]
      : undefined;
    try {
      const policy = updateComposioInstallationPolicy(service.currentConfig as Config, c.req.param('toolkit'), {
        allowedAgentIds,
        selectedConnectionIds,
        confirmationPolicy,
      });
      return c.json({ ok: true, payload: { policy } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.get('/api/connectors/approvals', (c) => {
    const status = c.req.query('status');
    const allowedStatuses = new Set(['pending', 'approved', 'denied', 'expired', 'consumed']);
    if (status && !allowedStatuses.has(status)) {
      return c.json({ ok: false, error: 'Invalid approval status.' }, 400);
    }
    const principalId = c.req.query('principalId')?.trim() || 'local-owner';
    const sessionKey = c.req.query('sessionKey')?.trim() || undefined;
    const approvals = listConnectorApprovals({
      principalId,
      sessionKey,
      status: status as 'pending' | 'approved' | 'denied' | 'expired' | 'consumed' | undefined,
      limit: Number(c.req.query('limit') ?? '100'),
    });
    return c.json({ ok: true, payload: { approvals } });
  });

  authenticated.post('/api/connectors/approvals/respond', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const decision = record.decision;
    if (!id || (decision !== 'approved' && decision !== 'denied')) {
      return c.json({ ok: false, error: 'Approval id and an approved or denied decision are required.' }, 400);
    }
    const current = getConnectorApproval(id);
    if (!current) return c.json({ ok: false, error: 'Connector approval not found.' }, 404);
    const approval = decideConnectorApproval(id, decision);
    if (!approval || approval.status !== decision) {
      return c.json({ ok: false, error: `Connector approval is ${approval?.status ?? 'unavailable'}.`, payload: { approval } }, 409);
    }
    return c.json({ ok: true, payload: { approval } });
  });

  authenticated.post('/api/connectors/:id/auth/start', strictRateLimitMiddleware, async (c) => {
    const connectorId = c.req.param('id');
    const connector = getConnectorDefinition(connectorId);
    if (!connector) {
      return c.json({ ok: false, error: `Unknown connector: ${connectorId}` }, 404);
    }
    try {
      const authorization = await startConnectorAuthorization(connector);
      return c.json({ ok: true, payload: { authorization } });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  authenticated.get('/api/connectors/composio/setup-status', async (c) => {
    const configured = Boolean(await resolveComposioApiKey());
    return c.json({ ok: true, payload: { configured } });
  });

  authenticated.post('/api/connectors/composio/setup', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const apiKey = body && typeof body === 'object' && !Array.isArray(body)
      ? String((body as Record<string, unknown>).apiKey ?? '')
      : '';
    try {
      await configureComposioApiKey(apiKey);
      return c.json({ ok: true, payload: { configured: true } });
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

  authenticated.post('/api/connectors/:id/source-sync', strictRateLimitMiddleware, async (c) => {
    const config = service.currentConfig as Config;
    try {
      const result = await ingestLocalFolderSource({
        config,
        connectorId: c.req.param('id'),
        agentId: resolveDefaultAgentId(config),
      });
      return c.json({ ok: true, payload: result });
    } catch (error) {
      return c.json({ ok: false, error: errorMessage(error) }, 400);
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
