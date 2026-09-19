import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRequire = createRequire(path.join(root, 'web/package.json'));
const { default: react } = await import(webRequire.resolve('@vitejs/plugin-react'));
const output = await mkdtemp(path.join(tmpdir(), 'xopc-connectors-visual-'));
const server = await createServer({ root: path.join(root, 'web'), configFile: false,
  plugins: [react(), tailwindcss()], resolve: { alias: { '@': path.join(root, 'web/src') } },
  server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [1280, 375]) for (const mode of ['light', 'dark']) for (const stage of ['gmail', 'airtable', 'service']) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto(`${server.resolvedUrls.local[0]}connectors-visual.html?toolkit=${stage}&mode=${mode}&stage=${stage}`, { waitUntil: 'networkidle' });
    const container = page.locator(stage === 'service' ? 'main' : '[role="dialog"]');
    await container.waitFor();
    const bounds = await container.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'Content must fit viewport');
    if (stage !== 'service') {
      assert(bounds.height < 550, 'Simple connection dialog must remain compact');
      if (stage === 'gmail') assert.equal(await container.locator('input[type="checkbox"]').isChecked(), false);
    } else {
      assert.equal(await container.locator('details').getAttribute('open'), null);
      await container.locator('summary').click();
      assert(await container.locator('input').isVisible());
    }
    await page.screenshot({ path: path.join(output, `${stage}-${mode}-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(`12 connector UI cases passed. Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
