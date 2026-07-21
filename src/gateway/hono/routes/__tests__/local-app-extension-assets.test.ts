import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { ExtensionLoader } from '../../../../extensions/loader.js';
import type { GatewayService } from '../../../service.js';
import { registerPublicExtensionAssetRoutes } from '../auth-registry-extensions.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('installed Local App asset route', () => {
  it('serves the discovered iframe entry without gateway credentials', async () => {
    const root = join(tmpdir(), `xopc-local-app-assets-${process.pid}-${Date.now()}`);
    roots.push(root);
    const extensionId = 'local-asset-health';
    const extensionRoot = join(root, extensionId);
    mkdirSync(join(extensionRoot, 'ui'), { recursive: true });
    writeFileSync(join(extensionRoot, 'index.js'), 'export default {};\n');
    writeFileSync(join(extensionRoot, 'ui', 'app.js'), 'document.body.dataset.ready = "true";');
    writeFileSync(join(extensionRoot, 'ui', 'index.html'), '<!doctype html><script type="module" src="./app.js"></script>');
    writeFileSync(join(extensionRoot, 'xopc.extension.json'), JSON.stringify({
      id: extensionId,
      name: 'Asset Health',
      version: '1.0.0',
      kind: 'utility',
      main: 'index.js',
      ui: { main: 'ui/index.html' },
      engines: { xopc: '>=0.0.0' },
    }));
    const loader = new ExtensionLoader({ extensionsDir: root, workspaceExtensionsDir: join(root, 'workspace') });
    const service = { getExtensionLoader: () => loader } as unknown as GatewayService;
    const app = new Hono();
    registerPublicExtensionAssetRoutes(app, service);

    const response = await app.request(`/api/extensions/${extensionId}/assets/ui/index.html`, {
      headers: { Origin: 'null' },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(response.headers.get('access-control-allow-origin')).toBe('null');
    expect(html).toContain(`/api/extensions/${extensionId}/assets/ui/app.js`);
    expect(html).not.toContain('token=');
  });
});
