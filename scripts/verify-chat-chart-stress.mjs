import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import playwright from 'playwright-core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(repo, 'web');
const require = createRequire(path.join(web, 'package.json'));
process.chdir(web);
const { build, preview } = await import(require.resolve('vite'));
const output = await mkdtemp(path.join(os.tmpdir(), 'xopc-chart-stress-build-'));
const directory = await mkdtemp(path.join(os.tmpdir(), 'xopc-chart-stress-results-'));
const rounds = Number(process.env.CHART_STRESS_ROUNDS ?? 6);
const throttle = Number(process.env.CHART_STRESS_CPU ?? 1);
assert.ok(Number.isInteger(rounds) && rounds > 0, 'CHART_STRESS_ROUNDS must be a positive integer');
assert.ok(Number.isFinite(throttle) && throttle >= 1, 'CHART_STRESS_CPU must be at least 1');
const label = process.argv[2] ?? 'current';
const report = { label, startedAt: new Date().toISOString(), rounds, cpuThrottling: throttle,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()),
  fixtureSeed: 'synthetic-chart-history-v1',
  environment: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model },
  budgets: { activeInline: 2, activeWithDialog: 3, mountedVirtualRows: 80, postGcGrowthMiB: 8,
    scrollFrameP95Ms: throttle > 1 ? 50 : 34, scrollFramesOver50Ratio: 0.05 },
  samples: [], phases: [], memory: [], errors: [], violations: [] };
const save = () => writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] ?? 0;
const check = (ok, message) => { if (!ok) report.violations.push(message); };
let server;
let browser;

// Test-only build instrumentation counts real ECharts instances without retaining the instances or DOM nodes.
const instrumentation = {
  name: 'chart-stress-counters', enforce: 'pre',
  transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/components/charts/echarts-runtime.ts')) return;
    return code.replace('import { init, use }', 'import { init as originalInit, use }').replace('export { init };', `
      const stats = globalThis.__chartCounters ??= { created: 0, disposed: 0, peak: 0, active: new Set(), colors: {} };
      export function init(...args) {
        const chart = originalInit(...args);
        if (!stats.active.has(chart.id)) {
          stats.created++; stats.active.add(chart.id); stats.peak = Math.max(stats.peak, stats.active.size);
          const dispose = chart.dispose; const setOption = chart.setOption;
          chart.setOption = function(option, ...rest) { stats.colors[this.id] = option.backgroundColor; return setOption.call(this, option, ...rest); };
          chart.dispose = function(...rest) {
            if (stats.active.delete(this.id)) stats.disposed++;
            delete stats.colors[this.id]; return dispose.apply(this, rest);
          };
        }
        return chart;
      }
    `);
  },
};

try {
  console.log(JSON.stringify({ stage: 'build', label, directory }));
  await build({ root: web, configFile: path.join(web, 'vite.config.ts'), logLevel: 'error', plugins: [instrumentation],
    build: { outDir: output, sourcemap: false, rollupOptions: { input: path.join(web, 'src/visual-tests/chat-chart-stress/index.html') } } });
  server = await preview({ root: web, configFile: false, build: { outDir: output }, preview: { host: '127.0.0.1', port: 0 } });
  browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const cdp = await page.context().newCDPSession(page);
  const browserCdp = await browser.newBrowserCDPSession();
  await cdp.send('Performance.enable');
  if (throttle !== 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  report.browser = browser.version();
  page.on('pageerror', error => report.errors.push(error.message));
  page.setDefaultTimeout(15_000);
  await page.goto(`${server.resolvedUrls.local[0]}src/visual-tests/chat-chart-stress/index.html`);
  await page.waitForFunction(() => Boolean(window.chartStress));
  await page.evaluate(() => {
    window.__startProbe = () => {
      const frames = []; const tasks = []; let last = performance.now(); let frame;
      const tick = now => { frames.push(now - last); last = now; frame = requestAnimationFrame(tick); };
      frame = requestAnimationFrame(tick);
      const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({ type: 'longtask' });
      window.__stopProbe = () => { cancelAnimationFrame(frame); observer.disconnect(); return { frames, tasks }; };
    };
  });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const sample = async name => {
    const value = await page.evaluate(() => ({ ...window.chartStress.sample(), counters: window.__chartCounters
      ? { created: window.__chartCounters.created, disposed: window.__chartCounters.disposed,
        active: window.__chartCounters.active.size, peak: window.__chartCounters.peak, colors: Object.values(window.__chartCounters.colors) } : null }));
    value.jsHeapUsedMiB = (await cdp.send('Runtime.getHeapUsage')).usedSize / 1024 ** 2;
    report.samples.push({ name, ...value });
    check((value.counters?.active ?? 0) <= (value.dialogs ? 3 : 2), `${name}: instance budget exceeded`);
    if (value.virtualized) check(value.rows <= 80, `${name}: mounted ${value.rows} virtual rows (budget 80)`);
    return value;
  };
  const phase = async (name, work) => {
    await page.evaluate(() => window.__startProbe());
    const started = Date.now();
    try { await work(); }
    catch (error) { report.errors.push(`${name}: ${String(error)}`); }
    const timing = await page.evaluate(() => window.__stopProbe());
    report.phases.push({ name, elapsedMs: Date.now() - started, frameCount: timing.frames.length,
      frameP50Ms: percentile(timing.frames, .5), frameP95Ms: percentile(timing.frames, .95),
      maxFrameMs: Math.max(0, ...timing.frames), over50Ratio: timing.frames.filter(ms => ms > 50).length / Math.max(1, timing.frames.length),
      longTasks: timing.tasks });
    await sample(name); await save();
    if (name === 'focus-0') await page.screenshot({ path: path.join(directory, 'virtual-history.png') });
  };
  const mount = async (id, options) => {
    await page.evaluate(({ id, options }) => window.chartStress.mount(id, options), { id, options });
    await page.waitForFunction(() => Boolean(document.querySelector('[data-chat-message-row]')));
    await page.waitForFunction(() => Boolean(document.querySelector('[data-chart-block] canvas')));
    // Let Virtuoso finish its initial end positioning before requesting another target.
    await page.waitForTimeout(250);
    await settle();
  };
  const reveal = async index => {
    assert.ok(await page.evaluate(index => window.chartStress.reveal(index), index));
    await page.waitForFunction(index => {
      const row = document.querySelector(`[data-chat-message-index="${index}"]`);
      const viewport = document.querySelector('[data-chat-scroll-viewport]');
      if (!row || !viewport) return false;
      const rect = row.getBoundingClientRect(); const box = viewport.getBoundingClientRect();
      return rect.bottom > box.top && rect.top < box.bottom;
    }, index).catch(async error => {
      report.errors.push(JSON.stringify(await page.evaluate(index => ({ index, sample: window.chartStress.sample(),
        rows: [...document.querySelectorAll('[data-chat-message-row]')].map(row => ({ index: row.getAttribute('data-chat-message-index'), top: row.getBoundingClientRect().top, bottom: row.getBoundingClientRect().bottom })) }), index)));
      await page.screenshot({ path: path.join(directory, 'failure.png') });
      throw error;
    });
    await settle();
  };
  const memory = async name => {
    await page.evaluate(() => window.chartStress.unmount()); await settle();
    await cdp.send('HeapProfiler.collectGarbage'); await settle(); await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage'); const dom = await cdp.send('Memory.getDOMCounters');
    const processes = await browserCdp.send('SystemInfo.getProcessInfo');
    let rendererRssKiB = null;
    try { rendererRssKiB = processes.processInfo.filter(process => process.type === 'renderer')
      .reduce((total, process) => total + Number(execFileSync('ps', ['-p', String(process.id), '-o', 'rss='], { encoding: 'utf8' }).trim()), 0); } catch {}
    const value = await sample(name);
    check((value.counters?.active ?? 0) === 0, `${name}: instances retained after unmount`);
    report.memory.push({ name, jsHeapUsedMiB: heap.usedSize / 1024 ** 2, jsHeapTotalMiB: heap.totalSize / 1024 ** 2,
      backingStorageMiB: heap.backingStorageSize / 1024 ** 2, rendererRssMiB: rendererRssKiB === null ? null : rendererRssKiB / 1024, ...dom });
  };

  for (const rows of [300, 1000]) {
    await mount(`size-${rows}`, { rows });
    await reveal(Math.floor(rows / 2) | 1);
    await sample(`virtual-${rows}`);
    await page.evaluate(() => window.chartStress.release()); await settle();
  }
  await mount('dense', { rows: 40, dense: true });
  for (let i = 0; i < 10; i++) {
    await page.locator('[data-chat-scroll-viewport]').evaluate((element, i) => { element.scrollTop = i * (element.scrollHeight - element.clientHeight) / 9; }, i);
    await settle();
  }
  await sample('dense-40');
  for (const index of [0, 1]) {
    const figure = page.locator('[data-chart-block]').filter({ has: page.getByText(`Chart ${index}`, { exact: true }) });
    await figure.scrollIntoViewIfNeeded(); await settle();
    for (let i = 0; i < 4; i++) {
      await figure.getByRole('button', { name: /^(Enlarge chart|放大图表)$/ }).click();
      await page.getByRole('dialog').locator('canvas').waitFor();
      await page.evaluate(dark => window.chartStress.theme(dark), i % 2 === 0); await settle();
      const value = await sample(`dense-preview-${index}-${i}`);
      check(value.counters.colors.every(color => color === value.background), `dense-preview-${index}-${i}: preview theme mismatch`);
      await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await settle();
    }
  }
  await page.evaluate(() => window.chartStress.release()); await settle();
  await mount('large', { rows: 1, dense: true, points: 1000, series: 8 });
  await sample('large-8000-points'); await page.evaluate(() => window.chartStress.release()); await settle();
  for (const id of ['a', 'b']) { await mount(id, { rows: 1000 }); await reveal(501); }
  await memory('warm');

  for (let round = 0; round < rounds; round++) {
    console.log(JSON.stringify({ stage: 'round', round: round + 1, rounds }));
    await mount('a', { rows: 1000 }); await reveal(501);
    await phase(`scroll-${round}`, async () => {
      await page.mouse.move(620, 360);
      for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, i < 20 ? 180 : -180); await page.waitForTimeout(35); }
    });
    await reveal(501);
    const title = await page.locator('[data-chat-message-index="501"] [data-chart-block] figcaption span').first().innerText();
    const figure = page.locator('[data-chart-block]').filter({ has: page.getByText(title, { exact: true }) });
    const enlarge = figure.getByRole('button', { name: /^(Enlarge chart|放大图表)$/ });
    await phase(`focus-${round}`, async () => { await enlarge.focus(); await settle(); });
    await phase(`preview-${round}`, async () => {
      for (let i = 0; i < 8; i++) {
        await enlarge.click(); await page.getByRole('dialog').locator('canvas').waitFor(); await sample(`preview-open-${round}-${i}`);
        if (round === 0 && i === 0) await page.screenshot({ path: path.join(directory, 'preview.png') });
        await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await settle();
      }
    });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await phase(`theme-${round}`, async () => {
      for (let i = 0; i < 8; i++) {
        await page.evaluate(dark => window.chartStress.theme(dark), i % 2 === 0);
        await page.waitForTimeout(120); await settle();
        const value = await sample(`theme-${round}-${i}`);
        check(value.counters?.colors.every(color => color === value.background), `theme-${round}-${i}: chart background differs from current theme`);
      }
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await phase(`switch-${round}`, async () => {
      for (let i = 0; i < 6; i++) { await mount(i % 2 ? 'a' : 'b', { rows: 1000 }); await reveal(i % 2 ? 751 : 151); }
      await page.locator('[data-chat-message-index="751"]').getByRole('button', { name: /^(Enlarge chart|放大图表)$/ }).click();
      await page.getByRole('dialog').locator('canvas').waitFor();
      await mount('b', { rows: 1000 }); await reveal(501);
      check(await page.getByRole('dialog').count() === 0, `switch-${round}: preview portal retained after session switch`);
    });
    await memory(`round-${round}`); await save();
  }
  const baseline = report.memory[0].jsHeapUsedMiB;
  const end = report.memory.at(-1).jsHeapUsedMiB;
  report.postGcGrowthMiB = end - baseline;
  check(end - baseline <= report.budgets.postGcGrowthMiB, `Post-GC JS heap grew ${end - baseline} MiB`);
  for (const phase of report.phases.filter(phase => phase.name.startsWith('scroll-'))) {
    check(phase.frameP95Ms <= report.budgets.scrollFrameP95Ms, `${phase.name}: p95 frame ${phase.frameP95Ms}ms`);
    check(phase.over50Ratio <= report.budgets.scrollFramesOver50Ratio, `${phase.name}: slow-frame ratio ${phase.over50Ratio}`);
  }
  await page.evaluate(() => window.chartStress.release()); await memory('released');
  const final = report.samples.at(-1).counters;
  check(final.peak <= report.budgets.activeWithDialog, 'Transient instance peak exceeds dialog budget');
  check(final.created === final.disposed, 'Created/disposed instance counts do not match');
  report.passed = !report.errors.length && !report.violations.length;
  await save();
  console.log(JSON.stringify({ stage: 'finished', directory, passed: report.passed, postGcGrowthMiB: report.postGcGrowthMiB,
    counters: final, violations: report.violations, errors: report.errors }));
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.passed = false;
  report.errors.push(String(error));
  throw error;
} finally {
  report.finishedAt = new Date().toISOString(); await save();
  await browser?.close(); await server?.close(); await rm(output, { recursive: true, force: true });
}
