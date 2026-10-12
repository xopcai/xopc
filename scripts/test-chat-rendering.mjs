import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { chromium } from 'playwright-core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(repo, 'web');
const webRequire = createRequire(path.join(web, 'package.json'));
process.chdir(web);
const { build, preview } = await import(webRequire.resolve('vite'));
const output = await mkdtemp(path.join(tmpdir(), 'xopc-chat-render-'));
const label = process.argv[2] ?? 'current';
const runs = Number(process.env.CHAT_RENDER_RUNS ?? 10);
let server;
let browser;
try {
  await build({
    root: web, configFile: path.join(web, 'vite.config.ts'), logLevel: 'error',
    build: { outDir: output, sourcemap: false, rollupOptions: { input: path.join(web, 'src/visual-tests/chat-rendering/index.html') } },
  });
  server = await preview({ root: web, configFile: false, build: { outDir: output }, preview: { host: '127.0.0.1', port: 0 } });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}src/visual-tests/chat-rendering/index.html`);
  await page.waitForFunction(() => typeof window.runChatRenderingFixture === 'function');
  const scenarios = {};
  for (const name of ['prose', 'code', 'history']) {
    scenarios[name] = [];
    await page.evaluate(name => window.runChatRenderingFixture(name), name);
    for (let i = 0; i < runs; i++) scenarios[name].push(await page.evaluate(name => window.runChatRenderingFixture(name), name));
  }
  const historyRows = [];
  for (const count of [100, 300, 1000]) historyRows.push(await page.evaluate(count => window.runChatHistoryFixture(count), count));
  await mkdir(path.join(repo, 'docs/design/chat-rendering-results'), { recursive: true });
  await page.screenshot({ path: path.join(repo, `docs/design/chat-rendering-results/${label}-history.png`) });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { void window.runChatRenderingFixture('prose'); });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-xopc-segment]')).some(el => {
    const opacity = Number(getComputedStyle(el).opacity);
    return opacity > 0 && opacity < .99;
  }));
  const animatedSegments = await page.locator('[data-xopc-segment]').count();
  const activeAnimations = await page.evaluate(() => document.getAnimations().filter(animation => {
    const target = animation.effect?.target;
    return target instanceof Element && target.hasAttribute('data-xopc-segment');
  }).length);
  if (activeAnimations > 256) throw new Error('Streaming reveal exceeded its animation budget');
  const reports = path.join(repo, 'docs/design/chat-rendering-results');
  await mkdir(reports, { recursive: true });
  await page.screenshot({ path: path.join(reports, `${label}-streaming.png`) });
  await page.waitForFunction(() => !document.querySelector('[data-xopc-segment]'));
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] ?? 0;
  const summary = Object.fromEntries(Object.entries(scenarios).map(([name, samples]) => [name, {
    commitP50Ms: percentile(samples.flatMap(s => s.commitMs), .5),
    commitP95Ms: percentile(samples.flatMap(s => s.commitMs), .95),
    maxNodes: Math.max(...samples.map(s => s.nodes)),
    longTaskCount: samples.reduce((n, s) => n + s.longTasks.length, 0),
    textLength: samples.at(-1).textLength,
  }]));
  let gzipBytes = 0;
  for (const name of await readdir(path.join(output, 'assets'))) {
    if (name.endsWith('.js')) gzipBytes += gzipSync(await readFile(path.join(output, 'assets', name))).byteLength;
  }
  const report = {
    label, revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()),
    rendererVersions: { streamdown: '2.7.0', cjk: '1.0.4', virtuoso: '4.18.16' },
    cpuThrottling: 1, fixtureSeed: 'synthetic-fixed-v2',
    browser: browser.version(), viewport: { width: 1280, height: 800 }, reducedMotion: true,
    runs, gzipBytes, summary, scenarios, errors, animatedSegments, activeAnimations, historyRows,
  };
  await writeFile(path.join(reports, `${label}.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ label, summary, gzipBytes, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.httpServer.close(resolve) : resolve());
  await rm(output, { recursive: true, force: true });
}
