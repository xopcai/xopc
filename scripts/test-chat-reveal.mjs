import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(repo, 'web');
process.chdir(web);
const webRequire = createRequire(path.join(web, 'package.json'));
const { build, preview } = await import(webRequire.resolve('vite'));
const output = await mkdtemp(path.join(tmpdir(), 'xopc-chat-reveal-build-'));
const reports = await mkdtemp(path.join(tmpdir(), 'xopc-chat-reveal-report-'));
let server;
let browser;
try {
  await build({ root: web, configFile: path.join(web, 'vite.config.ts'), logLevel: 'error',
    build: { outDir: output, sourcemap: false, rollupOptions: { input: path.join(web, 'src/visual-tests/chat-rendering/index.html') } } });
  server = await preview({ root: web, configFile: false, build: { outDir: output }, preview: { host: '127.0.0.1', port: 0 } });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  const cases = [];
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}src/visual-tests/chat-rendering/index.html`);
    await page.waitForFunction(() => typeof window.runChatRevealFixture === 'function');
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), mobile);
    for (const options of [
      { intervalMs: 28, chunk: 1 },
      { intervalMs: 28, chunk: 1, personal: true },
      { intervalMs: 28, chunk: 2, formatted: true, personal: true },
      { intervalMs: 14, chunk: 16, formatted: true },
    ]) {
      const report = await page.evaluate(options => window.runChatRevealFixture(options), options);
      cases.push({ mobile, options, ...report });
      console.log(JSON.stringify({ mobile, options, ...report }));
    }
    await page.evaluate(() => { window.revealPromise = window.runChatRevealFixture({ chunk: 2, intervalMs: 35, personal: true, formatted: true }); });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-xopc-segment]')).some(element => {
      const opacity = Number(getComputedStyle(element).opacity);
      return opacity > 0 && opacity < 0.9;
    }));
    await page.screenshot({ path: path.join(reports, mobile ? 'mobile-streaming.png' : 'desktop-streaming.png') });
    await page.evaluate(() => window.revealPromise);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await page.evaluate(() => window.runChatRevealFixture({ chunk: 16, intervalMs: 14 }));
    cases.push({ mobile, reducedMotion: true, ...reduced });
    await page.close();
  }
  await writeFile(path.join(reports, 'reveal.json'), JSON.stringify({ browser: browser.version(), cases, errors }, null, 2));
  if (errors.length || cases.some(result => !result.complete || result.opacityDrops.length || result.maxLeadingDrift > 0.5 || result.cursorOpacityDrift > 0.01)) {
    throw new Error(`Streaming reveal stability failed; inspect ${reports}`);
  }
  console.log(JSON.stringify({ passed: cases.length, reports }));
} finally {
  await browser?.close();
  await server?.close();
  await rm(output, { recursive: true, force: true });
}
