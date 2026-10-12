import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
const output = await mkdtemp(path.join(tmpdir(), 'xopc-completion-build-'));
const reports = await mkdtemp(path.join(tmpdir(), 'xopc-completion-results-'));
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
  await page.waitForFunction(() => typeof window.runChatCompletionFixture === 'function');
  const cases = [];
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    for (const count of [12, 300]) for (const personal of [false, true]) {
      for (const burst of [false, true]) for (const reading of [false, true]) {
        const result = await page.evaluate(options => window.runChatCompletionFixture(options), { count, personal, burst, reading });
        cases.push({ reducedMotion, ...result });
      }
    }
  }
  await page.screenshot({ path: path.join(reports, 'completed-reply.png') });
  const report = { browser: browser.version(), cases, errors };
  await writeFile(path.join(reports, 'completion.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ cases: cases.length,
    maxLateScrollDrift: Math.max(...cases.map(result => result.lateScrollDrift)),
    maxReadingDrift: Math.max(...cases.map(result => result.readingDrift)), reports }, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  await rm(output, { recursive: true, force: true });
}
