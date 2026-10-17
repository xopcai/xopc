import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
execFileSync(process.execPath, [resolve(root, 'packages/chart-spec/scripts/build-mobile.mjs')], { cwd: root, stdio: 'inherit' });
const assets = resolve(root, 'packages/chart-spec/dist/mobile-preview');
const output = await mkdtemp(resolve(tmpdir(), 'xopc-mobile-charts-'));
const server = createServer(async (request, response) => {
  const name = request.url?.slice(1) || 'index.html';
  if (!['index.html', 'host.js', 'host.css'].includes(name)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  response.end(await readFile(resolve(assets, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.XOPC_CHART_TEST_BROWSER || "chrome" });
  const errors = [];
  const cases = [];
  for (const width of [320, 390, 768]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.chartMessages = [];
      window.XopcChartBridge = { postMessage: value => window.chartMessages.push(JSON.parse(value)) };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    let revision = 0;
    const render = async spec => {
      revision++;
      await page.evaluate(payload => window.xopcChart.update(payload), {
        id: 'chart-fixture', revision, source: JSON.stringify(spec), dark: width === 390, fontSize: width === 768 ? 24 : 14,
      });
    };
    const spec = {
      version: 1, type: 'line', title: '收入趋势 <img src=x onerror=alert(1)>', summary: '离线、多序列、缺失值和负数', dataKind: 'example',
      xAxis: { label: '月份', values: ['一月', '二月', '三月'] }, yAxis: { label: '金额', unit: '元' },
      series: [{ name: '甲', values: [1, null, -2] }, { name: '乙', values: [-3, 0, 2] }],
    };
    for (const type of ['line', 'bar']) {
      await render({ ...spec, type });
      assert.equal(await page.locator('canvas').count(), 1);
      assert.equal(await page.locator('tr').count(), 4);
      assert.equal(await page.locator('td').nth(4).textContent(), '—');
      assert.equal(await page.locator('td').nth(8).textContent(), '2');
      assert.equal(await page.locator('td').nth(2).textContent(), '-3');
      assert.equal(await page.locator('img').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.evaluate(() => window.xopcChart.exportImage());
      const exported = await page.evaluate(() => window.chartMessages.findLast(value => value.type === 'image'));
      assert.ok(exported.data.startsWith('data:image/png;base64,'));
      await page.screenshot({ path: resolve(output, `${type}-${width}.png`), fullPage: true });
      cases.push(`${type}-${width}`);
    }
    // A stale revision cannot replace the current plot with an error.
    await page.evaluate(payload => window.xopcChart.update(payload), { id: 'chart-fixture', revision: 1, source: '{}', dark: false });
    assert.equal(await page.locator('canvas').count(), 1);
    await render({ ...spec, version: 99 });
    assert.equal(await page.locator('canvas').count(), 0);
    assert.match(await page.locator('#status').textContent(), /UNSUPPORTED_VERSION/);
    assert.equal(await page.locator('#data').isVisible(), false);
    await render({ ...spec, series: [{ name: '空', values: [null, null, null] }] });
    assert.equal(await page.locator('canvas').count(), 0);
    await render({ ...spec, title: '中'.repeat(102400) });
    assert.match(await page.locator('#status').textContent(), /TOO_LARGE/);
    await render({ ...spec, type: 'bar', xAxis: { label: '样本', values: Array.from({ length: 1000 }, (_, i) => String(i)) },
      series: [{ name: '甲', values: Array.from({ length: 1000 }, (_, i) => i % 2 ? i : -i) }] });
    assert.equal(await page.locator('tr').count(), 1001);
    await page.evaluate(() => window.xopcChart.dispose());
    assert.equal(await page.locator('canvas').count(), 0);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: cases, additional: ['stale revision', 'invalid schema', 'all null', 'UTF-8 limit', '1000 points', 'dispose', 'PNG export', 'text injection'], screenshots: output }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
