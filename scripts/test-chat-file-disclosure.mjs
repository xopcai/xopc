import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(repo, 'web');
process.chdir(web);
const require = createRequire(path.join(web, 'package.json'));
const { build, preview } = await import(require.resolve('vite'));
const output = await mkdtemp(path.join(tmpdir(), 'xopc-file-disclosure-'));
let server;
let browser;
try {
  await build({ root: web, configFile: path.join(web, 'vite.config.ts'), logLevel: 'error',
    build: { outDir: output, sourcemap: false, rollupOptions: { input: path.join(web, 'src/visual-tests/chat-rendering/index.html') } } });
  server = await preview({ root: web, configFile: false, build: { outDir: output },
    preview: { host: '127.0.0.1', port: 0 } });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}src/visual-tests/chat-rendering/index.html`);
  await page.waitForFunction(() => typeof window.mountChatFileDisclosureFixture === 'function');
  const reports = [];
  for (const count of [12, 360]) for (const selected of [false, true]) for (const keyboard of [false, true]) {
    await page.evaluate(count => window.mountChatFileDisclosureFixture(count), count);
    const summary = page.locator('[data-result-attachment-group] summary');
    await summary.waitFor();
    await page.waitForTimeout(500);
    // Settle at the actual disclosure before measuring; click must not need to scroll it into view.
    await summary.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const read = () => summary.evaluate(element => {
      const viewport = element.closest('[data-chat-scroll-viewport]');
      return { top: viewport.scrollTop, height: viewport.scrollHeight,
        summaryTop: element.getBoundingClientRect().top,
        rows: viewport.querySelectorAll('[data-chat-message-row]').length };
    });
    const before = await read();
    if (selected) {
      await summary.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element.closest('[data-chat-message-row]').querySelector('.markdown-body p:last-child'));
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await page.waitForTimeout(250);
      const afterSelection = await read();
      assert.ok(Math.abs(afterSelection.summaryTop - before.summaryTop) <= 1, `Selection moved file control: ${JSON.stringify({ before, afterSelection })}`);
      assert.ok(count < 300 || afterSelection.rows < 100, 'Selection mounted the entire history');
    }
    if (keyboard) {
      await summary.focus();
      await summary.press('Enter');
    } else await summary.click();
    await page.waitForTimeout(500);
    assert.equal(await summary.evaluate(element => element.parentElement.open), true);
    const after = await read();
    assert.ok(after.height > before.height, 'File list did not grow');
    assert.ok(Math.abs(after.top - before.top) <= 1, `Disclosure moved viewport: ${JSON.stringify({ count, selected, keyboard, before, after })}`);
    assert.ok(Math.abs(after.summaryTop - before.summaryTop) <= 1, 'File control moved');
    reports.push({ count, selected, keyboard, drift: after.top - before.top });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: reports.length, cases: reports }, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  await rm(output, { recursive: true, force: true });
}
