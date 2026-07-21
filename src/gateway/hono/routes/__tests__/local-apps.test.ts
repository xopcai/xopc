import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import type { GatewayService } from '../../../service.js';
import { registerPublicLocalAppPreviewRoutes } from '../local-apps.js';

describe('local app preview routes', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('serves token-scoped assets with sandbox and opaque-origin headers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-local-app-preview-'));
    roots.push(root);
    mkdirSync(join(root, 'ui'), { recursive: true });
    writeFileSync(join(root, 'ui', 'index.html'), '<!doctype html><script type="module" src="./app.js"></script>');
    writeFileSync(join(root, 'ui', 'app.js'), 'document.body.dataset.ready = "true";');
    const service = {
      localApps: {
        resolvePreview: (token: string) => token === 'valid-token'
          ? { app: {}, previewToken: token, uiRoot: root }
          : null,
      },
    } as unknown as GatewayService;
    const app = new Hono();
    registerPublicLocalAppPreviewRoutes(app, service);

    const response = await app.request('/api/local-apps/preview/valid-token/ui/app.js', {
      headers: { Origin: 'null' },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('dataset.ready');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(response.headers.get('access-control-allow-origin')).toBe('null');
  });

  it('injects a CSP-authorized runtime diagnostics bridge into preview HTML', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-local-app-preview-'));
    roots.push(root);
    mkdirSync(join(root, 'ui'), { recursive: true });
    mkdirSync(join(root, '.xopc'), { recursive: true });
    writeFileSync(join(root, 'ui', 'index.html'), '<!doctype html><html><head></head><body></body></html>');
    writeFileSync(join(root, '.xopc', 'acceptance.json'), JSON.stringify({
      schemaVersion: 1,
      scenarios: [{ id: 'open', name: 'Open app', steps: [{ action: 'click', target: 'open' }] }],
    }));
    const service = {
      localApps: {
        resolvePreview: () => ({ app: {}, previewToken: 'valid-token', uiRoot: root }),
      },
    } as unknown as GatewayService;
    const app = new Hono();
    registerPublicLocalAppPreviewRoutes(app, service);

    const response = await app.request('/api/local-apps/preview/valid-token/ui/index.html');
    const html = await response.text();

    expect(html).toContain('data-xopc-runtime-bridge');
    expect(html).toContain('name="xopc-local-app-acceptance"');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self' 'sha256-");
  });

  it('does not reveal previews for unknown tokens', async () => {
    const service = { localApps: { resolvePreview: () => null } } as unknown as GatewayService;
    const app = new Hono();
    registerPublicLocalAppPreviewRoutes(app, service);

    const response = await app.request('/api/local-apps/preview/unknown/ui/index.html');

    expect(response.status).toBe(404);
  });
});
