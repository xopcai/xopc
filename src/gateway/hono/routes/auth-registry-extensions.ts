import type { Hono } from 'hono';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import type { Config as SurfaceConfig } from '../../../config/config-surface.js';
import type { GatewayService } from '../../service.js';
import { buildWhenContextSnapshot } from '../../../extensions/when-context.js';
import * as extensionMarketplace from '../../../extensions/marketplace.js';
import { mergeActivationContext } from '../../../extensions/activation-context.js';
import { ActivationPlanner } from '../../../extensions/activation-planner.js';
import { getAllModels, getAvailableModels, type Model, type Api } from '../../../providers/index.js';
import { createOAuthHandler, loadOAuthCredentialsToCache } from '../oauth.js';
import { createOAuthAsyncHandler } from '../oauth-async.js';
import { extensionAssetMimeType } from '../lib/extension-assets.js';
import { loadExtensionStore, saveExtensionStore } from '../lib/extension-store.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const EXTENSION_ASSET_CSP =
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

/** Sandboxed extension iframes send `Origin: null`; echo it (and real origins) so every status includes ACAO. */
function extensionUiAssetCorsAllowOrigin(c: { req: { header: (name: string) => string | undefined } }): string {
  const origin = c.req.header('origin');
  if (origin === 'null') return 'null';
  if (origin) return origin;
  return '*';
}

function rewriteExtensionAssetHtml(html: string, extensionId: string, assetPath: string): string {
  const assetDir = assetPath.includes('/') ? assetPath.slice(0, assetPath.lastIndexOf('/') + 1) : '';
  const assetBase = `/api/extensions/${extensionId}/assets/${assetDir}`;

  return html
    .replace(/(<script\b[^>]*?\ssrc=)(["'])(\.\/)?([^"']+)\2/gi, (_match, tag, quote, _dot, file) => {
      const isAbsolute =
        file.startsWith('/') || file.startsWith('http://') || file.startsWith('https://');
      const resolvedSrc = isAbsolute ? file : `${assetBase}${file}`;
      return `${tag}${quote}${resolvedSrc}${quote} crossorigin="anonymous"`;
    })
    .replace(/(<link\b[^>]*?\shref=)(["'])(\.\/)?([^"']+)\2/gi, (_match, tag, quote, _dot, file) => {
      const isAbsolute =
        file.startsWith('/') || file.startsWith('http://') || file.startsWith('https://');
      const resolvedHref = isAbsolute ? file : `${assetBase}${file}`;
      return `${tag}${quote}${resolvedHref}${quote}`;
    });
}

function hasNonEmptyConfigSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const properties = (schema as { properties?: unknown }).properties;
  return Boolean(properties && typeof properties === 'object' && Object.keys(properties).length > 0);
}

/**
 * Register extension UI asset routes on the public (unauthenticated) app.
 *
 * Sandboxed iframes (`sandbox="allow-scripts …"` without `allow-same-origin`) have an
 * opaque origin of `null`, so sub-resource requests from inside the iframe cannot
 * carry the `?token=` query parameter that was on the parent HTML URL. Putting these
 * routes behind the auth middleware therefore causes every JS/CSS asset to return 401.
 *
 * Security is maintained by the strict Content-Security-Policy returned with every
 * asset (`frame-ancestors 'self'`), which prevents any page other than the gateway
 * console itself from embedding the extension iframes.
 */
export function registerPublicExtensionAssetRoutes(app: Hono, service: GatewayService): void {
  app.get('/api/extensions/:id/assets/*', async (c) => {
    const acao = extensionUiAssetCorsAllowOrigin(c);
    const corsHdr = { 'Access-Control-Allow-Origin': acao } as const;

    const extensionId = c.req.param('id');
    const loader = service.getExtensionLoader();
    if (!loader) {
      return c.json({ error: 'Extensions unavailable' }, 503, corsHdr);
    }

    const discovered = loader.discoverExtensions();
    const ext = discovered.find((e) => e.id === extensionId);
    if (!ext || !ext.manifest.ui) {
      return c.json({ error: 'Extension not found or has no UI' }, 404, corsHdr);
    }

    const prefix = `/api/extensions/${extensionId}/assets/`;
    const assetPathEncoded = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : '';
    let assetPath = assetPathEncoded;
    try {
      assetPath = decodeURIComponent(assetPathEncoded);
    } catch {
      return c.json({ error: 'Invalid asset path' }, 400, corsHdr);
    }

    if (!assetPath || assetPath.includes('..')) {
      return c.json({ error: 'Invalid asset path' }, 400, corsHdr);
    }

    const root = resolve(ext.path);
    const fullPath = resolve(root, assetPath);
    const rel = relative(root, fullPath);
    if (rel.startsWith('..') || rel === '') {
      return c.json({ error: 'Path traversal denied' }, 403, corsHdr);
    }

    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      return c.json({ error: 'Not found' }, 404, corsHdr);
    }

    const rawContent = readFileSync(fullPath);
    const mimeType = extensionAssetMimeType(assetPath);

    const body: string | Uint8Array = mimeType.startsWith('text/html')
      ? rewriteExtensionAssetHtml(rawContent.toString('utf-8'), extensionId, assetPath)
      : new Uint8Array(rawContent);

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Security-Policy': EXTENSION_ASSET_CSP,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': acao,
      },
    });
  });
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
    return c.json({ extensions });
  });

  /**
   * Built-in (bundled) extension enable/disable — persists `extensions.enabled` / `extensions.disabled`.
   * Body: `{ extensionId: string, enabled: boolean }`
   */
  authenticated.post('/api/extensions/bundled/activation', strictRateLimitMiddleware, async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { extensionId?: unknown; enabled?: unknown }
      | null;
    const extensionId =
      typeof body?.extensionId === 'string' ? body.extensionId.trim() : '';
    if (!extensionId) {
      return c.json({ ok: false, error: { message: 'extensionId is required' } }, 400);
    }
    if (typeof body?.enabled !== 'boolean') {
      return c.json({ ok: false, error: { message: 'enabled must be a boolean' } }, 400);
    }
    const result = await service.setBundledExtensionActivationTarget(extensionId, body.enabled);
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

  authenticated.get('/api/context', (c) => {
    const loader = service.getExtensionLoader();
    const snapshot = buildWhenContextSnapshot(
      service.currentConfig as unknown as SurfaceConfig,
      loader,
    );
    return c.json(snapshot);
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
      const payload = await service.fetchExtensionMarketplacePackageDetail(pkgName);
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
      const payload = await service.installExtensionFromMarketplace({ name, version, overwrite });
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
      const payload = await service.uninstallUserExtension(extensionId);
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
