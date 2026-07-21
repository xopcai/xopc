import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import type { Hono } from 'hono';

import { extensionAssetMimeType } from '../lib/extension-assets.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import type { GatewayService } from '../../service.js';
import {
  injectLocalAppRuntimeBridge,
  LOCAL_APP_RUNTIME_BRIDGE_HASH,
} from '../../../local-apps/preview-runtime-bridge.js';
import { readLocalAppAcceptanceConfig } from '../../../local-apps/acceptance.js';
import type { RecordLocalAppAcceptanceInput } from '../../../local-apps/types.js';

const LOCAL_APP_PREVIEW_CSP =
  "default-src 'self'; " +
  `script-src 'self' 'sha256-${LOCAL_APP_RUNTIME_BRIDGE_HASH}'; ` +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "connect-src 'none'; " +
  "frame-ancestors 'self'; " +
  "frame-src 'none'; " +
  "base-uri 'none'; " +
  "object-src 'none'; " +
  "form-action 'none'";

export function registerPublicLocalAppPreviewRoutes(app: Hono, service: GatewayService): void {
  app.get('/api/local-apps/preview/:token/*', (c) => {
    const origin = c.req.header('origin');
    const cors = { 'Access-Control-Allow-Origin': origin === 'null' ? 'null' : origin || '*' } as const;
    const preview = service.localApps.resolvePreview(c.req.param('token'));
    if (!preview) return c.json({ error: 'Preview not found' }, 404, cors);
    const prefix = `/api/local-apps/preview/${preview.previewToken}/`;
    let assetPath = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : '';
    try {
      assetPath = decodeURIComponent(assetPath);
    } catch {
      return c.json({ error: 'Invalid asset path' }, 400, cors);
    }
    if (!assetPath || assetPath.includes('..')) return c.json({ error: 'Invalid asset path' }, 400, cors);
    const root = resolve(preview.uiRoot);
    const fullPath = resolve(root, assetPath);
    const rel = relative(root, fullPath);
    if (rel.startsWith('..') || rel === '') return c.json({ error: 'Path traversal denied' }, 403, cors);
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) return c.json({ error: 'Not found' }, 404, cors);
    const mimeType = extensionAssetMimeType(assetPath);
    const content = readFileSync(fullPath);
    let textContent: string | null = null;
    if (mimeType.startsWith('text/html')) {
      let acceptance;
      try {
        acceptance = readLocalAppAcceptanceConfig(preview.uiRoot);
      } catch {
        acceptance = { schemaVersion: 1 as const, scenarios: [] };
      }
      textContent = injectLocalAppRuntimeBridge(content.toString('utf8'), acceptance);
    } else if (mimeType.startsWith('text/')) {
      textContent = content.toString('utf8');
    }
    return new Response(textContent ?? new Uint8Array(content), {
      headers: {
        'Content-Type': mimeType,
        'Content-Security-Policy': LOCAL_APP_PREVIEW_CSP,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...cors,
      },
    });
  });
}

export function registerLocalAppsRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  app.get('/api/local-apps', (c) => c.json({ apps: deps.service.localApps.list() }));

  app.post('/api/local-apps', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    if (typeof body.name !== 'string' || typeof body.idea !== 'string') {
      return c.json({ error: 'name and idea are required' }, 400);
    }
    const appDetail = deps.service.localApps.create({
      name: body.name,
      idea: body.idea,
      description: typeof body.description === 'string' ? body.description : undefined,
    });
    return c.json({ app: appDetail }, 201);
  });

  app.get('/api/local-apps/:id', (c) => {
    const appDetail = deps.service.localApps.get(c.req.param('id'));
    return appDetail ? c.json({ app: appDetail }) : c.json({ error: 'Local app not found' }, 404);
  });

  app.post('/api/local-apps/:id/validate', (c) => {
    return c.json({ validation: deps.service.localApps.validate(c.req.param('id')) });
  });

  app.post('/api/local-apps/:id/acceptance-runs', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const acceptance = deps.service.localApps.recordAcceptance(
      c.req.param('id'),
      body as unknown as RecordLocalAppAcceptanceInput,
    );
    return c.json({ acceptance }, 201);
  });

  app.post('/api/local-apps/:id/install', async (c) => {
    const appDetail = await deps.service.localApps.install(c.req.param('id'));
    return c.json({ app: appDetail });
  });

  app.post('/api/local-apps/:id/releases/:releaseId/rollback', async (c) => {
    const appDetail = await deps.service.localApps.rollback(
      c.req.param('id'),
      c.req.param('releaseId'),
    );
    return c.json({ app: appDetail });
  });

  app.post('/api/local-apps/:id/enable', async (c) => {
    const appDetail = await deps.service.localApps.setEnabled(c.req.param('id'), true);
    return c.json({ app: appDetail });
  });

  app.post('/api/local-apps/:id/disable', async (c) => {
    const appDetail = await deps.service.localApps.setEnabled(c.req.param('id'), false);
    return c.json({ app: appDetail });
  });

  app.delete('/api/local-apps/:id/install', async (c) => {
    const appDetail = await deps.service.localApps.uninstall(c.req.param('id'));
    return c.json({ app: appDetail });
  });
}
