/** Exercise real connector UI with deterministic authorization responses; no provider calls. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const { chromium } = require('playwright-core') as typeof import('playwright-core');
const { createServer } = await import(require.resolve('vite'));
const vite = await createServer({ root: fileURLToPath(new URL('../web', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
await vite.listen();
const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ executablePath: process.env.XOPC_SMOKE_BROWSER ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  for (const lang of ['en', 'zh']) {
    const page = await browser.newPage({ viewport: { width: lang === 'zh' ? 390 : 1200, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let state = 'preparing';
    let scope = 'read';
    let step = 1;
    await page.route('**/api/connectors/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/artifact')) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=', 'base64') });
      let payload: unknown = {};
      if (path.endsWith('/accounts')) payload = { accounts: state === 'succeeded' ? [{ id: 'user', label: 'Verified user', identity: {}, status: 'active', enabled: true }] : [], policy: { maxScope: scope } };
      else if (path.endsWith('/policy')) { scope = route.request().postDataJSON().maxScope; payload = { policy: { maxScope: scope } }; }
      else if (path.endsWith('/cancel')) state = 'cancelled';
      else if (path.endsWith('/authorizations')) { state = 'awaiting_user'; payload = { authorization: { id: 'attempt', status: 'preparing' } }; }
      else if (path.endsWith('/authorizations/attempt')) payload = { authorization: { id: 'attempt', status: state, challenge: lang === 'zh' ? { type: 'qr_code', artifactId: 'attempt', step: 1, totalSteps: 1 } : { type: 'open_url', url: `https://example.com/authorize/${step}`, step, totalSteps: 2 } } };
      return route.fulfill({ json: { ok: true, payload } });
    });
    await page.goto(`${origin}/smoke/cli-connectors.html?lang=${lang}&dark=${lang === 'zh' ? 1 : 0}`);
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: lang === 'zh' ? '仅查看' : 'Read only', exact: true }).click();
    await page.getByRole('button', { name: lang === 'zh' ? '查看并执行操作' : 'Read and write', exact: true }).click();
    await page.waitForFunction(() => document.body.textContent?.includes('CLI Test'));
    await page.getByRole('button', { name: lang === 'zh' ? '连接账号' : 'Connect account', exact: true }).click();
    if (lang === 'zh') {
      const image = page.getByRole('img', { name: '授权二维码' }); await image.waitFor();
      await page.waitForFunction(() => [...document.images].some(image => image.complete && image.naturalWidth > 0));
    } else {
      await page.getByText('Step 1 of 2', { exact: false }).waitFor();
      step = 2;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.getByText('Step 2 of 2: Previous step complete.', { exact: false }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Open authorization page' }).getAttribute('href'), 'https://example.com/authorize/2');
      state = 'succeeded';
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.getByText('Account verified', { exact: true }).waitFor();
      await page.getByText('Verified user', { exact: true }).waitFor();
    }
    const box = await page.getByRole('dialog').boundingBox();
    assert(box && box.x >= 0 && box.width <= page.viewportSize()!.width);
    if (lang === 'zh') await page.getByRole('button', { name: '取消授权', exact: true }).click();
    await page.getByRole('button', { name: lang === 'zh' ? '连接账号' : 'Connect account', exact: true }).waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.body.dataset.closed === 'true');
    assert.equal(scope, 'write'); assert.deepEqual(errors, []);
    await page.close();
    console.log(`CLI dialog ${lang}: authorization, policy, cancel, keyboard and viewport passed`);
  }
} finally { await browser?.close(); await vite.close(); }
