import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { chromium } from 'playwright-core';

// Run the web Vite server first. Uses a separate headless Chrome session.
const base = process.argv[2] ?? 'http://127.0.0.1:5186';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const page = await context.newPage();
  const url = `${base}/src/visual-tests/chat-charts/`;
  await page.goto(url);
  const chart = page.locator('[data-chart-block]');
  await chart.locator('canvas').waitFor();
  await chart.getByRole('button', { name: 'Copy JSON', exact: true }).click();
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  assert.equal(copied.type, 'line');
  assert.deepEqual(copied.series[0].values, [12000, 12500, 13000]);

  const downloadEvent = page.waitForEvent('download');
  await chart.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const downloaded = await downloadEvent;
  const png = await readFile(await downloaded.path());
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(png.length > 1000);

  await chart.getByRole('button', { name: 'Source', exact: true }).click();
  assert.equal(await chart.locator('canvas').count(), 0);
  assert.equal(JSON.parse(await chart.locator('pre').innerText()).type, 'line');
  await chart.getByRole('button', { name: 'Chart', exact: true }).click();
  await chart.locator('canvas').waitFor();
  await chart.locator('summary').click();
  await chart.locator('table').waitFor();
  assert.ok((await chart.locator('table').innerText()).includes('13000'));

  await chart.getByRole('button', { name: 'Enlarge chart' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('canvas').waitFor();
  const preview = await dialog.boundingBox();
  assert.ok(preview.height > 400 && preview.width > 600);
  await page.keyboard.press('Escape');
  await chart.locator('canvas').waitFor();

  await page.getByRole('button', { name: 'Bar', exact: true }).click();
  await chart.locator('canvas').waitFor();
  assert.ok((await chart.innerText()).includes('Category spending'));
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await chart.locator('canvas').waitFor();
  assert.equal(await page.locator('html').evaluate(element => element.classList.contains('dark')), true);
  await page.getByRole('button', { name: 'Narrow', exact: true }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await chart.locator('canvas').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '/tmp/xopc-chat-chart-bar-mobile.png', fullPage: true });

  await page.getByRole('button', { name: 'Streaming', exact: true }).click();
  await page.locator('[data-chart-pending]').waitFor();
  assert.equal(await page.locator('canvas').count(), 0);
  await page.getByRole('button', { name: 'Streaming', exact: true }).click();
  await chart.locator('canvas').waitFor();
  await page.reload();
  await chart.locator('canvas').waitFor();
  await page.waitForLoadState('networkidle');
  assert.deepEqual(errors, []);

  for (const mode of ['invalid', 'pending']) {
    const fresh = await context.newPage();
    const requests = [];
    fresh.on('request', request => requests.push(request.url()));
    await fresh.goto(`${url}?${mode}=1`);
    await fresh.locator(mode === 'invalid' ? '[data-chart-error]' : '[data-chart-pending]').waitFor();
    await fresh.waitForLoadState('networkidle');
    assert.equal(requests.some(request => request.includes('/echarts-runtime')), false);
    assert.equal(await fresh.locator('canvas').count(), 0);
    await fresh.close();
  }
  assert.deepEqual(errors, []);
  console.log('Verified: line/bar, copy, PNG, source, data table, preview, theme, mobile, streaming, history, lazy engine loading.');
} finally {
  await browser.close();
}
