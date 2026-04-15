import type { Hono } from 'hono';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { getAllModels, getAvailableModels, type Model, type Api } from '../../../providers/index.js';
import { createOAuthHandler, loadOAuthCredentialsToCache } from '../oauth.js';
import { createOAuthAsyncHandler } from '../oauth-async.js';
import { extensionAssetMimeType } from '../lib/extension-assets.js';
import { loadExtensionStore, saveExtensionStore } from '../lib/extension-store.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerAuthRegistryExtensionsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

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

  // Load OAuth credentials from config into cache on startup
  loadOAuthCredentialsToCache(service);

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
      return c.json({ extensions: [] });
    }

    const registry = loader.getRegistry();
    const discovered = loader.discoverExtensions();
    const activeIds = new Set<string>();
    for (const [id] of registry.extensions) {
      activeIds.add(id);
    }

    const extensions = discovered.map((ext) => ({
      id: ext.manifest.id,
      name: ext.manifest.name,
      description: ext.manifest.description,
      version: ext.manifest.version,
      kind: ext.manifest.kind,
      source: ext.source,
      active: activeIds.has(ext.id),
      hasUi: Boolean(ext.manifest.ui),
      ui: ext.manifest.ui
        ? {
            icon: ext.manifest.ui.icon,
            permissions: ext.manifest.ui.permissions,
            contributions: ext.manifest.ui.contributions,
          }
        : undefined,
    }));
    return c.json({ extensions });
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

  authenticated.get('/api/extensions/:id/assets/*', async (c) => {
    const extensionId = c.req.param('id');
    const loader = service.getExtensionLoader();
    if (!loader) {
      return c.json({ error: 'Extensions unavailable' }, 503);
    }

    const discovered = loader.discoverExtensions();
    const ext = discovered.find((e) => e.id === extensionId);
    if (!ext || !ext.manifest.ui) {
      return c.json({ error: 'Extension not found or has no UI' }, 404);
    }

    const prefix = `/api/extensions/${extensionId}/assets/`;
    const assetPathEncoded =
      c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : '';
    let assetPath = assetPathEncoded;
    try {
      assetPath = decodeURIComponent(assetPathEncoded);
    } catch {
      return c.json({ error: 'Invalid asset path' }, 400);
    }

    if (!assetPath || assetPath.includes('..')) {
      return c.json({ error: 'Invalid asset path' }, 400);
    }

    const root = resolve(ext.path);
    const fullPath = resolve(root, assetPath);
    const rel = relative(root, fullPath);
    if (rel.startsWith('..') || rel === '') {
      return c.json({ error: 'Path traversal denied' }, 403);
    }

    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      return c.json({ error: 'Not found' }, 404);
    }

    const content = readFileSync(fullPath);
    const mimeType = extensionAssetMimeType(assetPath);

    const cspHeader =
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; " +
      "connect-src 'none'; " +
      "frame-ancestors 'self'; " +
      "frame-src 'none'; " +
      "base-uri 'none'; " +
      "object-src 'none'; " +
      "form-action 'none'";

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Security-Policy': cspHeader,
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  authenticated.get('/api/extensions/:id/storage', async (c) => {
    const extensionId = c.req.param('id');
    const store = await loadExtensionStore(extensionId);
    return c.json({ keys: Object.keys(store) });
  });

  authenticated.get('/api/extensions/:id/storage/:key', async (c) => {
    const extensionId = c.req.param('id');
    const key = decodeURIComponent(c.req.param('key'));
    const store = await loadExtensionStore(extensionId);
    if (!(key in store)) {
      return c.json({ error: 'Key not found' }, 404);
    }
    return c.json({ value: store[key] });
  });

  authenticated.put('/api/extensions/:id/storage/:key', async (c) => {
    const extensionId = c.req.param('id');
    const key = decodeURIComponent(c.req.param('key'));
    const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null;
    if (body === null || !('value' in body)) {
      return c.json({ error: 'Request body must contain a "value" field' }, 400);
    }
    const store = await loadExtensionStore(extensionId);
    store[key] = body.value;
    await saveExtensionStore(extensionId, store);
    return c.json({ ok: true });
  });

  authenticated.delete('/api/extensions/:id/storage/:key', async (c) => {
    const extensionId = c.req.param('id');
    const key = decodeURIComponent(c.req.param('key'));
    const store = await loadExtensionStore(extensionId);
    delete store[key];
    await saveExtensionStore(extensionId, store);
    return c.json({ ok: true });
  });

  authenticated.get('/api/extensions/:id/config', async (c) => {
    const extensionId = c.req.param('id');
    return c.json(await loadExtensionStore(`__config__${extensionId}`));
  });

  authenticated.patch('/api/extensions/:id/config', async (c) => {
    const extensionId = c.req.param('id');
    const patch = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return c.json({ error: 'Request body must be a JSON object' }, 400);
    }
    const namespace = `__config__${extensionId}`;
    const config = await loadExtensionStore(namespace);
    Object.assign(config, patch);
    await saveExtensionStore(namespace, config);
    return c.json({ ok: true });
  });

  // POST /api/registry/reload — reload gateway config and refresh model list for clients
  authenticated.post('/api/registry/reload', async (c) => {
    try {
      // Reload config
      await service.reloadConfig();
      
      // Reload OAuth credentials from new config
      loadOAuthCredentialsToCache(service);
      
      const models = getAllModels();
      
      // Emit SSE event to all connected clients
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
