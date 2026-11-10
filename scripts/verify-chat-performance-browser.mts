import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
import { build, preview } from 'vite';

const directory = await mkdtemp(join(resolve('web'), '.chat-perf-'));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: Awaited<ReturnType<typeof preview>> | undefined;
try {
  await writeFile(join(directory, 'index.html'), '<html><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>');
  await writeFile(join(directory, 'fixture.tsx'), `
import { useState, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import { ChatMarkdownRenderer } from '@/features/chat/rendering/markdown/chat-markdown-renderer';
import { useProgressiveStreamingMarkdown } from '@/features/chat/messages/use-progressive-streaming-markdown';
import '@/components/markdown/streaming-render-metrics';
import { beginResponseLatency, bindResponseLatency, recordResponseText } from '@/features/chat/messages/response-latency';
import '@/styles/globals.css';
function Fixture() {
  const [state, setState] = useState({ content: '', streaming: true });
  const visible = useProgressiveStreamingMarkdown(state.content, state.streaming, 'browser', false, undefined, true);
  window.update = (content, streaming = true, responseRunId) => flushSync(() => setState({content, streaming, responseRunId}));
  window.beginFixtureResponse = () => {
    const timing = beginResponseLatency('fixture');
    bindResponseLatency('fixture', 'fixture-run', timing);
    recordResponseText('fixture-run');
  };
  useLayoutEffect(() => { window.lastLayout = visible; }, [visible]);
  return <MemoryRouter><ChatMarkdownRenderer content={visible} streaming={state.streaming} streamingMetricsKey="browser" responseRunId={state.responseRunId} /></MemoryRouter>;
}
function Benchmark() {
  const [state, setState] = useState({ content: '', legacy: false });
  const host = useRef(null);
  window.benchUpdate = (content, legacy) => flushSync(() => setState({content, legacy}));
  useLayoutEffect(() => {
    if (!state.legacy) return;
    const start = performance.now();
    // Previous production layout effect, applied to the same rendered DOM.
    const paragraphs = host.current.querySelector('.markdown-render-boundary').querySelectorAll('p');
    for (const paragraph of paragraphs) {
      paragraph.hidden = false;
      const link = paragraph.querySelector('a');
      if (!link || paragraph.textContent?.trim() !== link.textContent?.trim() ||
        !/^(?:查看(?:高清|原|大)?图片|查看大图|查看原图|view(?: (?:full[- ]size|original|hd))? image)$/i.test(link.textContent?.trim() ?? '')) continue;
      const next = paragraph.nextElementSibling ?? paragraph.closest('.markdown-stream-block')?.nextElementSibling?.firstElementChild;
      const images = next?.querySelectorAll('img[data-chat-image-source]');
      if (next?.matches('[data-chat-media]') && images?.length === 1 && images[0].dataset.chatImageSource === link.getAttribute('href')) paragraph.hidden = true;
    }
    window.lastScanMs = performance.now() - start;
    window.lastScannedParagraphs = paragraphs.length;
  }, [state]);
  return <div ref={host}><MemoryRouter><ChatMarkdownRenderer content={state.content} streaming /></MemoryRouter></div>;
}
const root = createRoot(document.getElementById('root'));
root.render(<Fixture />);
window.mountBenchmark = () => flushSync(() => root.render(<Benchmark />));
window.runBenchmark = async () => {
  const fixture = window as any;
  fixture.mountBenchmark();
  const head = Array.from({ length: 500 }, (_, i) => '已完成的普通段落 ' + i + '。\\n\\n').join('');
  const baseline: number[] = [];
  const optimized: number[] = [];
  const scan: number[] = [];
  let paragraphsScanned = 0;
  let optimizedFullScans = 0;
  let legacy = false;
  const original = Element.prototype.querySelectorAll;
  Element.prototype.querySelectorAll = function(selector: string) {
    if (!legacy && selector === 'p' && this.classList.contains('markdown-render-boundary')) optimizedFullScans++;
    return original.call(this, selector);
  };
  try {
    fixture.benchUpdate(head + '生成中。', false);
    for (let round = 0; round < 7; round++) {
      for (const baselineMode of round % 2 ? [false, true] : [true, false]) {
        legacy = baselineMode;
        fixture.benchUpdate(head + '生成中。', legacy);
        for (let delta = 1; delta <= 30; delta++) {
          if (delta % 5 === 1) await new Promise(resolve => requestAnimationFrame(resolve));
          const start = performance.now();
          fixture.benchUpdate(head + '生成中。' + '字'.repeat(delta), legacy);
          const duration = performance.now() - start;
          if (round === 0) continue;
          (legacy ? baseline : optimized).push(duration);
          if (legacy) {
            scan.push(fixture.lastScanMs);
            paragraphsScanned += fixture.lastScannedParagraphs;
          }
        }
      }
    }
  } finally {
    Element.prototype.querySelectorAll = original;
  }
  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p75Ms: sorted[Math.ceil(sorted.length * .75) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] };
  };
  return { completedParagraphs: 500, deltasPerVariant: baseline.length, paragraphsScanned, optimizedFullScans,
    baselineCommit: stats(baseline), optimizedCommit: stats(optimized), removedScan: stats(scan) };
};
`);
  const outDir = join(directory, 'dist');
  await build({ configFile: resolve('web/vite.config.ts'), root: directory, logLevel: 'error',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: join(directory, 'index.html') } } });
  server = await preview({ configFile: resolve('web/vite.config.ts'), root: directory, logLevel: 'error', build: { outDir },
    preview: { host: '127.0.0.1', port: 0, open: false } });
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('xopc.performance', '1'));
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.waitForFunction(() => typeof (window as any).update === 'function');
  const first = await page.evaluate(() => {
    (window as any).update('第一段立即显示。');
    return { layout: (window as any).lastLayout, text: document.body.textContent };
  });
  assert.equal(first.layout, '第一段立即显示。');
  assert.ok(first.text?.includes(first.layout));
  const content = '第一段立即显示。\n\n' + Array.from({ length: 100 }, (_, i) => `第 ${i} 段：公式 $a^2+b^2=c^2$。\n\n`).join('')
    + '| 列 | 值 |\n| --- | --- |\n| 中文 | 42 |\n\n```typescript\nconst greeting = "你好";\n```\n';
  await page.evaluate(content => (window as any).update(content), content);
  await page.evaluate(content => (window as any).update(content, false), content);
  await page.waitForFunction(() => document.querySelector('table') && document.querySelector('pre code'));
  assert.ok((await page.locator('body').innerText()).includes('第 99 段'));
  assert.equal((await page.locator('pre code').textContent())?.trimEnd(), 'const greeting = "你好";');
  const metrics = await page.evaluate(() => ({
    render: typeof (window as any).__xopcStreamingRenderMetrics === 'function',
    response: typeof (window as any).__xopcResponseLatencyMetrics === 'function',
    samples: (window as any).__xopcStreamingRenderMetrics?.(),
  }));
  assert.ok(metrics.render && metrics.response);
  assert.ok(metrics.samples?.length);
  assert.deepEqual(errors, []);
  await page.evaluate(() => {
    (window as any).beginFixtureResponse();
    (window as any).update('---', true, 'fixture-run');
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => (window as any).__xopcResponseLatencyMetrics()[0].firstVisibleMs), undefined);
  await page.evaluate(() => (window as any).update('实际可见的回答。', false, 'fixture-run'));
  await page.waitForFunction(() => Number.isFinite((window as any).__xopcResponseLatencyMetrics()[0]?.firstVisibleMs));

  if (process.argv.includes('--benchmark')) {
    const result = await page.evaluate(() => (window as any).runBenchmark());
    assert.equal(result.optimizedFullScans, 0);
    assert.equal(result.paragraphsScanned, (result.completedParagraphs + 1) * result.deltasPerVariant);
    console.log(JSON.stringify({ markdownBenchmark: result }, null, 2));
  }
  // A fresh production context has no diagnostic collection without opt-in.
  const plain = await browser.newPage();
  await plain.goto(`http://127.0.0.1:${address.port}`);
  await plain.waitForFunction(() => typeof (window as any).update === 'function');
  assert.equal(await plain.evaluate(() => (window as any).__xopcStreamingRenderMetrics), undefined);
  console.log(JSON.stringify({ production: true, firstDeltaImmediate: true, terminalSnapshotComplete: true,
    chineseMathTableCode: true, visibleTextTiming: true, diagnosticsOptInOnly: true, pageErrors: errors.length }, null, 2));
} finally {
  await browser?.close();
  await new Promise<void>(resolve => server ? server.httpServer.close(() => resolve()) : resolve());
  await rm(directory, { recursive: true, force: true });
}
