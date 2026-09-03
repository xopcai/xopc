import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { getShareStore, resetShareStoreForTests } from '../../share/share-store.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

describe('shared HTML through the gateway security middleware', () => {
  let root: string;
  let previousStateDir: string | undefined;
  const html = '<!doctype html><body><button onclick="this.textContent = 2">1</button><script>document.body.dataset.ready = "yes"</script>';

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'xopc-share-csp-')));
    previousStateDir = process.env.XOPC_STATE_DIR;
    process.env.XOPC_STATE_DIR = root;
    resetShareStoreForTests();
    mkdirSync(join(root, 'workspace'));
    writeFileSync(join(root, 'workspace', 'course.html'), html);
  });

  afterEach(() => {
    resetShareStoreForTests();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(root, { recursive: true, force: true });
  });

  function createApp(inlinePreviewMimes = ['text/html']) {
    return createHonoApp({ service: {
      currentConfig: ConfigSchema.parse({ gateway: { share: { inlinePreviewMimes } } }),
      getHealth: () => ({ status: 'healthy' }),
      getResolvedAuth: () => ({ mode: 'token', token: 'test-token' }),
    } as unknown as GatewayService });
  }

  async function createShare(kind: 'file' | 'directory' = 'file') {
    return getShareStore().create({
      path: kind === 'file' ? 'course.html' : '.',
      kind,
      workspaceRoot: join(root, 'workspace'),
      gatewayTokenHash: 'test-hash',
    });
  }

  it.each(['file', 'directory'] as const)('allows inline scripts in %s HTML while isolating the console origin', async (kind) => {
    const record = await createShare(kind);
    const path = kind === 'file'
      ? `/s/${record.token}?inline=1`
      : `/s/${record.token}/file?path=course.html&inline=1`;
    const response = await createApp().request(path);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(html);
    expect(response.headers.get('content-disposition')).toContain('inline;');
    const csp = response.headers.get('content-security-policy')!;
    expect(csp).toContain("script-src 'unsafe-inline' https:");
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('keeps downloads, expired shares, and the console under the default CSP', async () => {
    const record = await createShare();
    const app = createApp();
    const download = await app.request(`/s/${record.token}/download`, { method: 'POST' });
    expect(download.headers.get('content-disposition')).toContain('attachment;');
    expect(download.headers.get('content-security-policy')).toContain("script-src 'self';");
    await download.text();
    getShareStore().revoke(record.id);
    const expired = await app.request(`/s/${record.token}?inline=1`);
    expect(expired.status).toBe(410);
    expect(expired.headers.get('content-security-policy')).toContain("script-src 'self';");
    expect((await app.request('/health')).headers.get('content-security-policy')).toContain("script-src 'self';");
  });

  it('respects the configured MIME whitelist', async () => {
    const record = await createShare();
    const response = await createApp(['image/png']).request(`/s/${record.token}?inline=1`);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self';");
    expect(await response.text()).not.toContain('dataset.ready');
  });
});
