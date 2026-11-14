import type { Hono } from 'hono';

import { isBundledChannelExtension } from '../../../channels/bundled-channel-extensions.js';
import type { Config as SurfaceConfig } from '../../../config/config-surface.js';
import { validateExtensionConfig } from '../../../extensions/config-validation.js';
import * as extensionMarketplace from '../../../extensions/marketplace.js';
import { mergeActivationContext } from '../../../extensions/activation-context.js';
import { ActivationPlanner } from '../../../extensions/activation-planner.js';
import { getAllModels, getAvailableModels, type Model, type Api } from '../../../providers/index.js';
import { createOAuthHandler } from '../oauth.js';
import { createOAuthAsyncHandler } from '../oauth-async.js';
import { loadExtensionStore, saveExtensionStore } from '../lib/extension-store.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { listAgentPluginInventory } from '../../../extensions/agent-plugins/inventory.js';
import { ExtensionUiGrantInputSchema } from '@xopcai/gateway-contract';
import { capabilityHttpContext, capabilityHttpError } from '../../../capabilities/adapters/http.js';
import { CapabilityError } from '../../../capabilities/runtime/errors.js';
import { bodyLimit } from 'hono/body-limit';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { listLocalAppAccess, recordLocalAppAccess } from '../../../local-apps/access-audit.js';
import { listAutomations } from '../../../automations/storage/index.js';
import { automationConfigurationDigest } from '../../../local-apps/capabilities/automation-policy.js';
import { automationProposalReview, assertProposalCurrent, readAutomationProposal, resolveAutomationProposal } from '../../../local-apps/automation-proposals.js';
import { createProductDispatcher } from '../../../capabilities/runtime/product.js';
import { z } from 'zod';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { localAppDelegationCaller } from '../../security/local-app-delegation-access.js';
import { assertResourceRequest, localAppConnectorOptions, readAppResourceRequest, resolveAppResourceRequest } from '../../../local-apps/p1-services.js';
import { getGatewayFileSpaceService } from '../../file-space-service.js';


function hasNonEmptyConfigSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const properties = (schema as { properties?: unknown }).properties;
  return Boolean(properties && typeof properties === 'object' && Object.keys(properties).length > 0);
}

export function registerAuthRegistryExtensionsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service, strictRateLimitMiddleware } = deps;

  // ========== Auth API (/api/auth) ==========

  // GET /api/auth/token - Get current gateway token
  authenticated.get('/api/auth/token', (c) => {
    const authToken = service.getAuthToken();
    return c.json({ 
      ok: true, 
      payload: { 
        token: authToken,
        mode: service.getAuthMode(),
      } 
    });
  });

  // POST /api/auth/token/refresh - Generate new gateway token
  authenticated.post('/api/auth/token/refresh', async (c) => {
    try {
      const newToken = await service.refreshAuthToken();
      return c.json({ 
        ok: true, 
        payload: { 
          token: newToken,
          message: 'Token refreshed successfully. Please update your client configuration.'
        } 
      });
    } catch (err) {
      return c.json({ 
        ok: false, 
        error: err instanceof Error ? err.message : 'Failed to refresh token' 
      }, 500);
    }
  });

  // ========== OAuth API (/api/auth/oauth) ==========
  authenticated.route('/api/auth/oauth', createOAuthHandler(service));

  // ========== Async OAuth API (/api/auth/oauth-async) ==========
  authenticated.route('/api/auth/oauth-async', createOAuthAsyncHandler(service));

  // ========== Registry API ==========
  
  // GET /api/registry - Full registry for frontend
  authenticated.get('/api/registry', async (c) => {
    const allModels = getAllModels();
    const availableModels = await getAvailableModels();
    const configured = new Set(availableModels.map(m => `${m.provider}/${m.id}`));
    
    // Group models by provider
    const providerMap = new Map<string, Model<Api>[]>();
    for (const model of allModels) {
      const list = providerMap.get(model.provider) ?? [];
      list.push(model);
      providerMap.set(model.provider, list);
    }
    
    return c.json({
      ok: true,
      payload: {
        version: 'pi-ai',
        providers: Array.from(providerMap.entries()).map(([id, models]) => ({
          id,
          name: id.charAt(0).toUpperCase() + id.slice(1),
          configured: models.some(m => configured.has(`${m.provider}/${m.id}`)),
          models: models.map(m => ({
            ref: `${m.provider}/${m.id}`,
            id: m.id,
            name: m.name,
            provider: m.provider,
            reasoning: m.reasoning ?? false,
            input: m.input ?? ['text'],
            contextWindow: m.contextWindow ?? 128000,
            maxTokens: m.maxTokens ?? 4096,
            cost: {
              input: m.cost?.input ?? 0,
              output: m.cost?.output ?? 0,
            },
            available: configured.has(`${m.provider}/${m.id}`),
          })),
        })),
      },
    });
  });

  // ========== Extension UI (manifest discovery + static assets) ==========

  authenticated.get('/api/extensions', async (c) => {
    const loader = service.getExtensionLoader();
    if (!loader) {
      return c.json({ extensions: listAgentPluginInventory() });
    }

    const registry = loader.getRegistry();
    const discovered = loader.discoverExtensions().filter((ext) => !isBundledChannelExtension(ext.id));
    const activeIds = new Set<string>();
    for (const [id] of registry.extensions) {
      activeIds.add(id);
    }

    loader.setConfig(service.currentConfig as unknown as SurfaceConfig);
    let activationEligibleIds: Set<string> = new Set();
    try {
      const planner = new ActivationPlanner(loader.buildManifestRegistry());
      activationEligibleIds = new Set(
        planner.getActivatedIds(mergeActivationContext(service.currentConfig as unknown as SurfaceConfig)),
      );
    } catch {
      activationEligibleIds = new Set();
    }

    const extensions = discovered.map((ext) => ({
      format: 'native-extension' as const,
      id: ext.manifest.id,
      name: ext.manifest.name,
      description: ext.manifest.description,
      version: ext.manifest.version,
      kind: ext.manifest.kind,
      source: ext.source,
      active: activeIds.has(ext.id),
      activationEligible: activationEligibleIds.has(ext.id),
      hasUi: Boolean(ext.manifest.ui),
      hasConfigSchema: hasNonEmptyConfigSchema(ext.manifest.configSchema),
      ui: ext.manifest.ui
        ? {
            icon: ext.manifest.ui.icon,
            permissions: ext.manifest.ui.permissions,
            contributions: ext.manifest.ui.contributions,
          }
        : undefined,
    }));
    return c.json({ extensions: [...extensions, ...listAgentPluginInventory()] });
  });

  const updateExtensionActivation = async (extensionId: string, enabled: boolean) => {
    return service.setExtensionActivationTarget(extensionId, enabled);
  };

  /** Enable/disable any discovered native extension. */
  authenticated.post('/api/extensions/:id/activation', strictRateLimitMiddleware, async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { enabled?: unknown }
      | null;
    const extensionId = c.req.param('id').trim();
    if (!extensionId) {
      return c.json({ ok: false, error: { message: 'extensionId is required' } }, 400);
    }
    if (typeof body?.enabled !== 'boolean') {
      return c.json({ ok: false, error: { message: 'enabled must be a boolean' } }, 400);
    }
    const result = await updateExtensionActivation(extensionId, body.enabled);
    if (!result.ok) {
      return c.json({ ok: false, error: { message: result.error ?? 'Request failed' } }, 400);
    }
    return c.json({
      ok: true,
      payload: { requiresGatewayRestart: result.requiresGatewayRestart },
    });
  });

  authenticated.get('/api/extensions/:id', async (c) => {
    const extensionId = c.req.param('id');
    const loader = service.getExtensionLoader();
    if (!loader) {
      return c.json({ error: 'Extensions unavailable' }, 503);
    }
    const discovered = loader.discoverExtensions();
    const ext = discovered.find((e) => e.id === extensionId);
    if (!ext) {
      return c.json({ error: 'Extension not found' }, 404);
    }
    const registry = loader.getRegistry();
    return c.json({
      id: ext.manifest.id,
      name: ext.manifest.name,
      description: ext.manifest.description,
      version: ext.manifest.version,
      kind: ext.manifest.kind,
      source: ext.source,
      path: ext.path,
      active: registry.extensions.has(ext.id),
      manifest: ext.manifest,
    });
  });

  authenticated.get('/api/extensions/:id/ui-grant', (c) => {
    return c.json({ grant: service.localApps.getUiGrant(c.req.param('id')) });
  });

  authenticated.get('/api/extensions/:id/automation-proposals/:proposalId', c => {
    try {
      const proposal = readAutomationProposal(c.req.param('id'), c.req.param('proposalId'));
      if (proposal.status !== 'pending' || proposal.decision) return c.json({ proposal });
      assertProposalCurrent(service.localApps, proposal);
      return c.json(automationProposalReview(proposal));
    } catch (error) { return capabilityHttpError(c, error); }
  });
  authenticated.post('/api/extensions/:id/automation-proposals/:proposalId/review', async c => {
    try {
      const decision = z.strictObject({ digest: z.string().regex(/^[a-f0-9]{64}$/), approve: z.boolean(), enable: z.boolean() })
        .parse(await c.req.json());
      const dispatcher = createProductDispatcher(() => service.notesServiceInstance, {
        getAutomations: () => service.automationServiceInstance, getProjects: () => service.projects,
      });
      const caller = localAppDelegationCaller(capabilityHttpContext(c), getGatewayPrincipal(c), () => service.getResolvedAuth());
      return c.json(await resolveAutomationProposal(service.localApps, dispatcher, c.req.param('id'), c.req.param('proposalId'), decision, caller));
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/extensions/:id/resource-requests/:requestId', c => {
    try {
      const request = readAppResourceRequest(c.req.param('id'), c.req.param('requestId'));
      if (request.status === 'pending') assertResourceRequest(service.localApps, request);
      return c.json({ request });
    } catch (error) { return capabilityHttpError(c, error); }
  });
  authenticated.post('/api/extensions/:id/resource-requests/:requestId/review', async c => {
    try {
      const decision = z.strictObject({ digest: z.string().regex(/^[a-f0-9]{64}$/), approve: z.boolean() }).parse(await c.req.json());
      const caller = localAppDelegationCaller(capabilityHttpContext(c), getGatewayPrincipal(c), () => service.getResolvedAuth());
      return c.json(await resolveAppResourceRequest({ getConfig: () => service.currentConfig as import('../../../config/schema.js').Config,
        getFiles: () => getGatewayFileSpaceService(service) }, service.localApps, c.req.param('id'), c.req.param('requestId'), decision.digest, decision.approve, caller));
    } catch (error) { return capabilityHttpError(c, error); }
  });
  authenticated.get('/api/extensions/:id/resource-options', async c => {
    const kind = c.req.query('kind');
    if (!['notes', 'tasks', 'projects', 'automations', 'files', 'connectors'].includes(kind ?? '')) return c.json({ error: 'Invalid resource kind' }, 400);
    const search = (c.req.query('search') ?? '').slice(0, 200);
    if (kind === 'files') {
      const items = (await getGatewayFileSpaceService(service).recent(100)).filter(file => file.kind === 'file'
        && file.size <= 512 * 1024 && !file.relativePath.split('/').some(part => part.startsWith('.'))
        && `${file.name} ${file.relativePath}`.toLowerCase().includes(search.toLowerCase()))
        .map(file => ({ id: file.id, title: `${file.name} · ${file.relativePath}` }));
      return c.json({ items });
    }
    if (kind === 'connectors') return c.json({ items: (await localAppConnectorOptions({ getConfig: () => service.currentConfig as import('../../../config/schema.js').Config,
      getFiles: () => getGatewayFileSpaceService(service) })).filter(item => item.title.toLowerCase().includes(search.toLowerCase())) });
    if (kind === 'automations') {
      const items = listAutomations().filter(item => item.name.toLowerCase().includes(search.toLowerCase())).slice(0, 100)
        .map(item => ({ id: item.id, title: item.name, configurationDigest: automationConfigurationDigest(item),
          runnable: item.enabled && item.action.kind === 'agent' && (!item.management || item.management.runnable),
          review: { action: item.action, safety: item.safety, delivery: item.delivery, conversationMode: item.conversationMode,
            reliability: item.reliability, projectId: item.projectId, enabled: item.enabled } }));
      return c.json({ items });
    }
    const table = kind === 'notes' ? 'notes' : kind === 'tasks' ? 'tasks' : 'projects';
    const column = kind === 'notes' ? 'note_id' : kind === 'tasks' ? 'task_id' : 'project_id';
    const title = kind === 'projects' ? 'name' : 'title';
    const items = getSqliteDatabase().prepare(`SELECT ${column} AS id, coalesce(${title}, ${column}) AS title FROM ${table}
      WHERE instr(lower(coalesce(${title}, '')), lower(?)) > 0 ORDER BY updated_at DESC, ${column} LIMIT 100`).all(search);
    return c.json({ items });
  });

  authenticated.get('/api/extensions/:id/access-audit', c => c.json({ items: listLocalAppAccess(c.req.param('id')) }));

  authenticated.post('/api/extensions/:id/ui-grant', async (c) => {
    const parsed = ExtensionUiGrantInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'A valid reviewed manifest and resource policy are required' }, 400);
    const body = parsed.data;
    if (service.localApps.getUiGrant(c.req.param('id')).manifestDigest !== body.manifestDigest) {
      return c.json({ error: 'Extension release changed; review permissions again' }, 409);
    }
    try {
      const grant = service.localApps.grantUiPermissions(c.req.param('id'), body.manifestDigest, body.resourceScopes);
      recordLocalAppAccess(c.req.param('id'), { principalId: capabilityHttpContext(c).principalId, action: 'grant', status: 'succeeded', grantRevision: grant.grantRevision });
      return c.json({ grant });
    } catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.delete('/api/extensions/:id/ui-grant', async c => {
    const parsed = ExtensionUiGrantInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'The reviewed manifestDigest is required' }, 400);
    try {
      const grant = service.localApps.revokeUiPermissions(c.req.param('id'), parsed.data.manifestDigest);
      recordLocalAppAccess(c.req.param('id'), { principalId: capabilityHttpContext(c).principalId, action: 'revoke', status: 'succeeded' });
      return c.json({ grant });
    }
    catch (error) { return capabilityHttpError(c, error); }
  });

  // Old UI SDK storage calls must obey the same release and grant boundary as capabilities.
  authenticated.use('/api/extensions/:id/storage/*', (c, next) => service.localApps.isLocalApp(c.req.param('id'))
    ? bodyLimit({ maxSize: 1_050_000 })(c, next) : next());
  authenticated.use('/api/extensions/:id/storage', async (c, next) => {
    try { service.localApps.assertUiPermission(c.req.param('id'), c.req.header('X-Xopc-Extension-Manifest'), c.req.header('X-Xopc-Extension-Grant'), 'storage'); }
    catch (error) { return capabilityHttpError(c, error); }
    await next();
    try { service.localApps.assertUiPermission(c.req.param('id'), c.req.header('X-Xopc-Extension-Manifest'), c.req.header('X-Xopc-Extension-Grant'), 'storage'); }
    catch (error) { return capabilityHttpError(c, error); }
  });
  authenticated.use('/api/extensions/:id/storage/*', async (c, next) => {
    let key: string;
    try { key = c.req.param('key') ?? decodeURIComponent(c.req.path.split('/').at(-1)!); }
    catch { return c.json({ error: 'Invalid storage key' }, 400); }
    if (key.length > 512 || ['__proto__', 'prototype', 'constructor'].includes(key)) return c.json({ error: 'Invalid storage key' }, 400);
    try { service.localApps.assertUiPermission(c.req.param('id'), c.req.header('X-Xopc-Extension-Manifest'), c.req.header('X-Xopc-Extension-Grant'), 'storage'); }
    catch (error) { return capabilityHttpError(c, error); }
    await next();
    try { service.localApps.assertUiPermission(c.req.param('id'), c.req.header('X-Xopc-Extension-Manifest'), c.req.header('X-Xopc-Extension-Grant'), 'storage'); }
    catch (error) { return capabilityHttpError(c, error); }
  });

  authenticated.get('/api/extensions/:id/storage', async (c) => {
    const extensionId = c.req.param('id');
    const store = await loadExtensionStore(extensionId);
    return c.json({ keys: Object.keys(store) });
  });

  authenticated.get('/api/extensions/:id/storage/:key', async (c) => {
    const extensionId = c.req.param('id');
    const key = c.req.param('key');
    const store = await loadExtensionStore(extensionId);
    if (!Object.hasOwn(store, key)) {
      return c.json({ error: 'Key not found' }, 404);
    }
    return c.json({ value: store[key] });
  });

  authenticated.put('/api/extensions/:id/storage/:key', async (c) => {
    const extensionId = c.req.param('id');
    const key = c.req.param('key');
    const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null;
    if (body === null || !('value' in body)) {
      return c.json({ error: 'Request body must contain a "value" field' }, 400);
    }
    const store = await loadExtensionStore(extensionId);
    store[key] = body.value;
    if (service.localApps.isLocalApp(extensionId) && Buffer.byteLength(JSON.stringify(store)) > 5_000_000) return capabilityHttpError(c, new CapabilityError('INVALID_INPUT', 'App storage quota exceeded'));
    service.localApps.assertUiPermission(extensionId, c.req.header('X-Xopc-Extension-Manifest'), c.req.header('X-Xopc-Extension-Grant'), 'storage');
    await saveExtensionStore(extensionId, store);
    return c.json({ ok: true });
  });

  authenticated.delete('/api/extensions/:id/storage/:key', async (c) => {
    const extensionId = c.req.param('id');
    const key = c.req.param('key');
    const store = await loadExtensionStore(extensionId);
    delete store[key];
    service.localApps.assertUiPermission(extensionId, c.req.header('X-Xopc-Extension-Manifest'), c.req.header('X-Xopc-Extension-Grant'), 'storage');
    await saveExtensionStore(extensionId, store);
    return c.json({ ok: true });
  });

  authenticated.get('/api/extensions/:id/config', async (c) => {
    const extensionId = c.req.param('id');
    const configured = service.currentConfig.extensions?.[extensionId];
    const config = configured && typeof configured === 'object' && !Array.isArray(configured)
      ? configured
      : {};
    return c.json(config);
  });

  authenticated.patch('/api/extensions/:id/config', async (c) => {
    const extensionId = c.req.param('id');
    const patch = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return c.json({ error: 'Request body must be a JSON object' }, 400);
    }
    const loader = service.getExtensionLoader();
    if (!loader) return c.json({ error: 'Extensions unavailable' }, 503);
    const extension = loader.discoverExtensions().find((entry) => entry.id === extensionId);
    if (!extension) return c.json({ error: 'Extension not found' }, 404);

    const current = service.currentConfig.extensions?.[extensionId];
    const config = {
      ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {}),
      ...patch,
    };
    const validation = validateExtensionConfig(extension.manifest.configSchema, config);
    if (validation.valid === false) {
      return c.json({ error: `Invalid extension config: ${validation.reason}` }, 400);
    }

    const extensions = { ...(service.currentConfig.extensions ?? {}), [extensionId]: config };
    const result = await service.updateConfig({ extensions });
    if (!result.updated) return c.json({ error: result.error ?? 'Failed to update config' }, 500);
    return c.json({ ok: true });
  });

  authenticated.all('/api/extensions/:id/runtime/*', async (c) => {
    const extensionId = c.req.param('id');
    const prefix = `/api/extensions/${extensionId}/runtime`;
    const path = c.req.path.slice(prefix.length) || '/';
    const handler = service.getExtensionRegistry()?.getHttpRoute(extensionId, path);
    if (!handler) return c.json({ error: 'Extension route not found' }, 404);

    const contentType = c.req.header('content-type') ?? '';
    let body: unknown;
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      body = contentType.includes('application/json')
        ? await c.req.json().catch(() => undefined)
        : await c.req.text().catch(() => undefined);
    }
    const response = await handler({
      method: c.req.method,
      url: c.req.url,
      headers: c.req.header(),
      body,
    });
    const headers = new Headers(response.headers);
    let responseBody: string | Uint8Array | null = null;
    if (response.body !== undefined) {
      if (typeof response.body === 'string' || response.body instanceof Uint8Array) {
        responseBody = response.body;
      } else {
        headers.set('Content-Type', headers.get('Content-Type') ?? 'application/json; charset=utf-8');
        responseBody = JSON.stringify(response.body);
      }
    }
    return new Response(responseBody, { status: response.status, headers });
  });

  authenticated.get('/api/marketplace', async (c) => {
    const q = c.req.query('q');
    const category = c.req.query('category');
    try {
      let extensions;
      if (typeof q === 'string' && q.trim()) {
        extensions = await extensionMarketplace.searchExtensions(q.trim());
      } else if (typeof category === 'string' && category.trim()) {
        extensions = await extensionMarketplace.listExtensions(category.trim());
      } else {
        const reg = await extensionMarketplace.fetchRegistry();
        extensions = reg.extensions;
      }
      return c.json({ ok: true, extensions });
    } catch (err) {
      return c.json(
        {
          ok: false,
          extensions: [],
          error: err instanceof Error ? err.message : 'marketplace fetch failed',
        },
        500,
      );
    }
  });

  authenticated.get('/api/marketplace/packages/:pkgName', async (c) => {
    const raw = c.req.param('pkgName');
    if (!raw) {
      return c.json({ ok: false, error: 'Missing package name' }, 400);
    }
    let pkgName: string;
    try {
      pkgName = decodeURIComponent(raw);
    } catch {
      return c.json({ ok: false, error: 'Invalid package name' }, 400);
    }
    try {
      const payload = await service.marketplace.fetchExtensionPackageDetail(pkgName);
      return c.json({ ok: true, payload });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Marketplace request failed' },
        502,
      );
    }
  });

  authenticated.post('/api/marketplace/install', strictRateLimitMiddleware, async (c) => {
    let body: { name?: unknown; version?: unknown; overwrite?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const version = typeof body.version === 'string' ? body.version.trim() : undefined;
    const overwrite =
      body.overwrite === true || body.overwrite === 'true' || body.overwrite === '1';
    if (!name) {
      return c.json(
        { ok: false, error: 'Expected { name: string, version?: string, overwrite?: boolean }' },
        400,
      );
    }
    try {
      const payload = await service.marketplace.installExtension({ name, version, overwrite });
      return c.json({ ok: true, payload });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Install failed' },
        400,
      );
    }
  });

  authenticated.post('/api/marketplace/uninstall', strictRateLimitMiddleware, async (c) => {
    let body: { extensionId?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    const extensionId = typeof body.extensionId === 'string' ? body.extensionId.trim() : '';
    if (!extensionId) {
      return c.json({ ok: false, error: 'Expected { extensionId: string }' }, 400);
    }
    try {
      const payload = await service.marketplace.uninstallExtension(extensionId);
      return c.json({ ok: true, payload });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Uninstall failed' },
        400,
      );
    }
  });

  // POST /api/registry/reload — reload gateway config and refresh model list for clients
  authenticated.post('/api/registry/reload', async (c) => {
    try {
      // Reload config
      await service.reloadConfig();
      
      const models = getAllModels();
      
      // Emit a realtime event to all connected clients.
      service.emit('registry.updated', { modelCount: models.length });
      
      return c.json({
        ok: true,
        payload: {
          message: 'Registry reloaded',
          modelCount: models.length,
        },
      });
    } catch (err) {
      return c.json({
        error: err instanceof Error ? err.message : 'Failed to reload registry',
      }, 500);
    }
  });

}
