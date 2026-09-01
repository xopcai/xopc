import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('static-ui cache', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'xopc-static-ui-'));
    process.env.XOPC_UI_STATIC_ROOT = tempRoot;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.XOPC_UI_STATIC_ROOT;
    vi.resetModules();
  });

  async function loadStaticUi() {
    return import('../static-ui.js');
  }

  it('caches immutable file content and serves ETag + Cache-Control', async () => {
    mkdirSync(join(tempRoot, 'assets'), { recursive: true });
    writeFileSync(join(tempRoot, 'assets', 'app.js'), 'console.log(1)', 'utf8');
    const staticUi = await loadStaticUi();
    staticUi.clearStaticUiCacheForTests();

    const first = staticUi.serveStaticFile('assets/app.js');
    const second = staticUi.serveStaticFile('assets/app.js');

    expect(first?.status).toBe(200);
    expect(first?.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(first?.headers.get('ETag')).toBeTruthy();
    expect(await first?.text()).toBe('console.log(1)');

    const stats = staticUi.getStaticUiCacheStats();
    expect(stats.entries).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);

    const etag = first?.headers.get('ETag') ?? '';
    const notModified = staticUi.serveStaticFile('assets/app.js', new Request('http://localhost/assets/app.js', {
      headers: { 'if-none-match': etag },
    }));
    expect(notModified?.status).toBe(304);
    expect(staticUi.getStaticUiCacheStats().notModified).toBe(1);

    expect(second?.headers.get('ETag')).toBe(etag);
  });

  it('always serves the current index entrypoint from disk', async () => {
    writeFileSync(join(tempRoot, 'index.html'), '<html>first</html>', 'utf8');
    const staticUi = await loadStaticUi();
    staticUi.clearStaticUiCacheForTests();

    const first = staticUi.serveStaticFile('index.html');
    const firstEtag = first?.headers.get('ETag');
    expect(await first?.text()).toBe('<html>first</html>');

    writeFileSync(join(tempRoot, 'index.html'), '<html>second</html>', 'utf8');
    const second = staticUi.serveStaticFile('index.html');

    expect(await second?.text()).toBe('<html>second</html>');
    expect(second?.headers.get('ETag')).not.toBe(firstEtag);
    expect(staticUi.getStaticUiCacheStats().entries).toBe(0);
  });

  it('prewarms default UI entrypoints', async () => {
    writeFileSync(join(tempRoot, 'favicon.ico'), 'ico', 'utf8');
    writeFileSync(join(tempRoot, 'logo.svg'), '<svg/>', 'utf8');
    const staticUi = await loadStaticUi();
    staticUi.clearStaticUiCacheForTests();

    const result = staticUi.prewarmStaticUiCache();
    expect(result.loaded).toBe(2);
    expect(staticUi.getStaticUiCacheStats().entries).toBe(2);
  });

  it('uses immutable cache headers for hashed assets', async () => {
    mkdirSync(join(tempRoot, 'assets'), { recursive: true });
    writeFileSync(join(tempRoot, 'assets', 'app.js'), 'console.log(1)', 'utf8');
    const staticUi = await loadStaticUi();
    staticUi.clearStaticUiCacheForTests();

    const response = staticUi.serveStaticFile('assets/app.js');
    expect(response?.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('serves web app manifests with the manifest content type', async () => {
    writeFileSync(join(tempRoot, 'site.webmanifest'), '{}', 'utf8');
    const staticUi = await loadStaticUi();

    const response = staticUi.serveStaticFile('site.webmanifest');

    expect(response?.headers.get('Content-Type')).toBe('application/manifest+json');
  });
});
