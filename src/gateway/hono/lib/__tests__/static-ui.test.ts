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

  it('caches file content and serves ETag + Cache-Control', async () => {
    writeFileSync(join(tempRoot, 'index.html'), '<html>hello</html>', 'utf8');
    const staticUi = await loadStaticUi();
    staticUi.clearStaticUiCacheForTests();

    const first = staticUi.serveStaticFile('index.html');
    const second = staticUi.serveStaticFile('index.html');

    expect(first?.status).toBe(200);
    expect(first?.headers.get('Cache-Control')).toBe('no-cache');
    expect(first?.headers.get('ETag')).toBeTruthy();
    expect(await first?.text()).toBe('<html>hello</html>');

    const stats = staticUi.getStaticUiCacheStats();
    expect(stats.entries).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);

    const etag = first?.headers.get('ETag') ?? '';
    const notModified = staticUi.serveStaticFile('index.html', new Request('http://localhost/', {
      headers: { 'if-none-match': etag },
    }));
    expect(notModified?.status).toBe(304);
    expect(staticUi.getStaticUiCacheStats().notModified).toBe(1);

    expect(second?.headers.get('ETag')).toBe(etag);
  });

  it('prewarms default UI entrypoints', async () => {
    writeFileSync(join(tempRoot, 'index.html'), '<html>warm</html>', 'utf8');
    writeFileSync(join(tempRoot, 'favicon.ico'), 'ico', 'utf8');
    const staticUi = await loadStaticUi();
    staticUi.clearStaticUiCacheForTests();

    const result = staticUi.prewarmStaticUiCache();
    expect(result.loaded).toBeGreaterThanOrEqual(2);
    expect(staticUi.getStaticUiCacheStats().entries).toBeGreaterThanOrEqual(2);
  });

  it('uses immutable cache headers for hashed assets', async () => {
    mkdirSync(join(tempRoot, 'assets'), { recursive: true });
    writeFileSync(join(tempRoot, 'assets', 'app.js'), 'console.log(1)', 'utf8');
    const staticUi = await loadStaticUi();
    staticUi.clearStaticUiCacheForTests();

    const response = staticUi.serveStaticFile('assets/app.js');
    expect(response?.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });
});
