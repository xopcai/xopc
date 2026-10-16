import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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
const output = await mkdtemp(path.join(tmpdir(), 'xopc-mcp-config-visual-'));
const server = await createServer({ root: path.join(root, 'web'), configFile: false,
  plugins: [react(), tailwindcss()], resolve: { alias: { '@': path.join(root, 'web/src') } },
  server: { host: '127.0.0.1', port: 0 } });
let browser;
let count = 0;
try {
  await server.listen();
  const executablePath = process.env.CHROME_EXECUTABLE_PATH || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Never open external authorization pages during fixture verification.
  page.on('popup', popup => void popup.close());
  for (const width of [1280, 375]) for (const mode of ['light', 'dark']) for (const lang of ['zh', 'en']) for (const stage of ['default', 'bearer', 'apiKey', 'headers', 'command', 'reference', 'disabled', 'import', 'oauth', 'error', 'success', 'reload', 'limited', 'tls']) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto(`${server.resolvedUrls.local[0]}mcp-config-visual.html?stage=${stage}&mode=${mode}&lang=${lang}`, { waitUntil: 'networkidle' });
    const dialog = page.getByRole('dialog').first();
    await dialog.waitFor();
    const labels = lang === 'zh'
      ? { auth: '认证方式', apiKey: 'API Key', import: '导入 MCP 配置', preview: '预览配置', apply: '使用所选服务', connect: '测试连接', save: '添加连接', signIn: '登录并连接', cancel: '取消授权' }
      : { auth: 'Authentication', apiKey: 'API Key', import: 'Import MCP configuration', preview: 'Preview configuration', apply: 'Use selected service', connect: 'Test connection', save: 'Add connection', signIn: 'Sign in and connect', cancel: 'Cancel authorization' };
    if (stage === 'apiKey') {
      await dialog.getByLabel(labels.auth, { exact: true }).click();
      await page.getByRole('button', { name: labels.apiKey, exact: true }).click();
      await dialog.getByPlaceholder('x-api-key').fill('X-Service-Key');
      await dialog.getByLabel('API Key', { exact: true }).fill('fixture-key');
    }
    if (stage === 'import') {
      await dialog.getByRole('button', { name: labels.import, exact: true }).click();
      await dialog.locator('textarea').fill('{"mcpServers":{"docs":{"url":"https://example.com/mcp"},"files":{"command":"node","args":["server.js"]}}}');
      await dialog.getByRole('button', { name: labels.preview, exact: true }).click();
      assert(await dialog.getByRole('button', { name: labels.apply, exact: true }).isEnabled());
    }
    if (stage === 'oauth' || stage === 'error' || stage === 'success' || stage === 'reload' || stage === 'limited' || stage === 'tls') {
      await dialog.getByPlaceholder('https://example.com/mcp').fill('https://example.com/mcp');
      await dialog.getByRole('button', { name: labels.connect, exact: true }).click();
      if (stage === 'oauth') {
        await dialog.getByRole('button', { name: labels.signIn, exact: true }).click();
        await dialog.getByRole('button', { name: labels.cancel, exact: true }).waitFor();
      } else if (stage === 'error' || stage === 'limited' || stage === 'tls') {
        await dialog.getByRole('alert').waitFor();
        if (stage === 'limited') assert.match(await dialog.getByRole('alert').innerText(), lang === 'zh' ? /操作过于频繁/ : /temporarily limiting/);
        if (stage === 'tls') assert.match(await dialog.getByRole('alert').innerText(), lang === 'zh' ? /HTTPS 证书/ : /HTTPS certificate/);
        assert.equal((await dialog.innerText()).includes('fixture-secret'), false);
        assert.equal(await dialog.getByRole('button', { name: labels.save, exact: true }).count(), 0);
      } else {
        await dialog.getByRole('button', { name: labels.save, exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.mcpFixtureRequests.some(request => request.includes('/commit') || request.startsWith('PATCH '))), false);
      }
    }
    if (stage === 'reload') {
      await dialog.getByRole('button', { name: labels.save, exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(await dialog.getByRole('button', { name: labels.save, exact: true }).count(), 0);
      assert.equal(await dialog.getByRole('button', { name: labels.connect, exact: true }).count(), 0);
    }
    const bounds = await dialog.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'Dialog must fit viewport');
    assert(bounds.y >= 0 && bounds.y + bounds.height <= 813, 'Dialog must fit vertically');
    assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Dialog must not overflow horizontally');
    assert(await dialog.locator('.overflow-y-auto').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Form must not overflow horizontally');
    if (['bearer', 'headers'].includes(stage)) assert.equal(await dialog.locator('input[type="password"]').count() > 0, true);
    // Expanded advanced settings must not move the outer dialog or footer.
    if (stage === 'default') {
      await page.keyboard.press('Tab');
      assert(await dialog.evaluate(el => el.contains(document.activeElement)), 'Keyboard focus must remain inside the dialog');
      const summary = dialog.locator('summary').first();
      await summary.click();
      const expanded = await dialog.boundingBox(); assert.equal(expanded.height, bounds.height);
      await summary.click();
    }
    await page.screenshot({ path: path.join(output, `${stage}-${lang}-${mode}-${width}.png`), fullPage: true });
    if (stage === 'success') {
      await dialog.getByRole('button', { name: labels.save, exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.mcpFixtureRequests.filter(request => request.includes('/commit')).length), 1);
    }
    if (stage === 'oauth') await dialog.getByRole('button', { name: labels.cancel, exact: true }).click();
    count++;
  }
  assert.deepEqual(errors, []);
  console.log(`${count} MCP configuration UI cases passed. Screenshots: ${output}`);
} finally {
  await browser?.close(); await server.close();
}
