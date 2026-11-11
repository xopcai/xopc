import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { encode } from 'gpt-tokenizer/model/gpt-4o';

import type { BrowserActionInput, BrowserControlResult, BrowserObservation } from '@xopcai/browser-control-contract';

import { EndpointToolRuntime } from '../src/endpoint-tools/index.js';

import { createBrowserDriver } from '../src/browser/drivers/create-driver.js';
import { formatBrowserObservation } from '../src/browser/observation/format.js';
import { BrowserRuntime } from '../src/browser/runtime/browser-runtime.js';
import { BrowserConfigSchema } from '../src/config/schema.js';

const executablePath = process.env.XOPC_BENCH_CHROMIUM_PATH;
const output = process.env.XOPC_BENCH_OUTPUT;
const repetitions = Number(process.argv[2] ?? 12);
const trace = process.env.XOPC_BENCH_TRACE ? console.error : () => {};
assert(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 100, 'Use 1–100 repetitions.');
const config = BrowserConfigSchema.parse({
  driver: { kind: 'playwright', headless: true, executablePath },
  observation: { maxNodes: 180, maxCharacters: 12_000, visualFallback: false },
  limits: { actionTimeoutMs: 7_000, sessionTimeoutMs: 60_000, maxSequenceLength: 5 },
  security: { allowedPrivateHosts: ['127.0.0.1'] },
});

type Execute = (input: BrowserActionInput) => Promise<BrowserControlResult>;
type Fixture = (execute: Execute, base: string) => Promise<void>;
type Sample = { task: string; durationMs: number; snapshotTokens: number; error?: string };

const fixtures: Record<string, Fixture> = {
  directory: async (execute, base) => {
    const page = observed(await execute({ action: 'navigate', url: base + '/directory' }));
    assert.equal(page.nodes.length, 60);
    const link = find(page, 'Reference 42');
    const target = observed(await execute({
      action: 'click', ref: link, revision: page.revision, expect: { titleIncludes: 'Reference 42' },
    }));
    assert.equal(new URL(target.url).pathname, '/reference');
  },
  form: async (execute, base) => {
    let page = observed(await execute({ action: 'navigate', url: base + '/form' }));
    page = observed(await execute({ action: 'fill', ref: find(page, 'Name'), revision: page.revision, value: '中文 Ada' }));
    assert.equal(page.nodes.find((node) => node.name === 'Name')?.value, '中文 Ada');
    page = observed(await execute({
      action: 'click', ref: find(page, 'Save draft'), revision: page.revision, expect: { textIncludes: 'Saved 中文 Ada' },
    }));
    assert(find(page, 'Saved 中文 Ada'));
  },
  filters: async (execute, base) => {
    let page = observed(await execute({ action: 'navigate', url: base + '/filters' }));
    page = observed(await execute({ action: 'select', ref: find(page, 'Region'), revision: page.revision, value: 'eu' }));
    assert.equal(page.nodes.find((node) => node.name === 'Region')?.value, 'eu');
    page = observed(await execute({ action: 'check', ref: find(page, 'Available only'), revision: page.revision, checked: true }));
    assert(page.nodes.find((node) => node.name === 'Available only')?.states.includes('checked'));
    assert(find(page, 'Europe available'));
  },
  delayed: async (execute, base) => {
    let page = observed(await execute({ action: 'navigate', url: base + '/delayed' }));
    page = observed(await execute({ action: 'click', ref: find(page, 'Start'), revision: page.revision }));
    page = observed(await execute({ action: 'wait', condition: 'text', value: 'Ready', revision: page.revision, timeoutMs: 3_000 }));
    assert(find(page, 'Ready'));
  },
  tabs: async (execute, base) => {
    const first = observed(await execute({ action: 'navigate', url: base + '/reference' }));
    const second = receipt(await execute({ action: 'tabs', operation: 'create', url: base + '/form' }))
      .tabs?.find((tab) => tab.active);
    assert(second && second.id !== first.tabId);
    assert.equal(new URL(second.url).pathname, '/form');
    receipt(await execute({ action: 'tabs', operation: 'activate', tabId: first.tabId }));
    assert.equal(observed(await execute({ action: 'observe', visual: 'never' })).title, 'Reference 42');
    const remaining = receipt(await execute({ action: 'tabs', operation: 'close', tabId: second.id })).tabs;
    assert.deepEqual(remaining?.map((tab) => tab.id), [first.tabId]);
  },
};

let slowResponse: ServerResponse | undefined;
let notifySlowRequest: (() => void) | undefined;
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/slow') {
    trace('fixture received slow navigation');
    slowResponse = response;
    notifySlowRequest?.();
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  const pages: Record<string, [string, string]> = {
    '/directory': ['Directory', Array.from({ length: 60 }, (_, index) =>
      `<a href="/reference">Reference ${index + 1}</a><br>`).join('')],
    '/reference': ['Reference 42', '<button>Reference details</button>'],
    '/form': ['Draft form', `<label for="name">Name</label><input id="name">
      <button onclick="result.textContent='Saved '+document.querySelector('#name').value">Save draft</button><button id="result">Unsaved</button>`],
    '/filters': ['Catalog', `<label for="region">Region</label>
      <select id="region"><option value="all">All</option><option value="eu">Europe</option></select>
      <label><input type="checkbox" onchange="result.textContent=region.value==='eu'&&this.checked?'Europe available':'Unfiltered'">Available only</label>
      <button id="result">Unfiltered</button>`],
    '/delayed': ['Delayed', '<button onclick="setTimeout(()=>this.textContent=\'Ready\',350)">Start</button>'],
    '/storage': ['Storage', `<button id="status"></button><script>
      if (location.search) { localStorage.setItem('private', 'alpha'); document.cookie='poc=alpha; path=/'; }
      document.querySelector('#status').textContent=(localStorage.getItem('private') ?? 'empty')+' '+(document.cookie || 'empty');
      </script>`],
  };
  const page = pages[url.pathname];
  if (!page) { response.writeHead(404).end(); return; }
  response.end(`<!doctype html><meta charset="utf-8"><title>${page[0]}</title>${page[1]}`);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
const closedSessions = new Set<string>();
const endpointTools = new EndpointToolRuntime();
const runtime = new BrowserRuntime({
  getConfig: () => config,
  createDriver: () => createBrowserDriver(config, endpointTools),
  emit: (type, payload) => {
    if (type === 'browser.session.closed') closedSessions.add(String(payload.sessionId));
  },
});
const samples: Sample[] = [];
try {
  observed(await runtime.execute('warm', { action: 'navigate', url: base + '/reference' }));
  for (let index = 0; index < repetitions; index += 1) {
    for (const [task, fixture] of Object.entries(fixtures)) {
      trace('task', index + 1, task);
      const sample: Sample = { task, durationMs: 0, snapshotTokens: 0 };
      const snapshots: string[] = [];
      const started = performance.now();
      try {
        await fixture(async (input) => {
          const result = await runtime.execute('warm', input);
          const observation = result.ok ? result.receipt.observation : result.error.observation;
          if (observation) snapshots.push(formatBrowserObservation(observation));
          return result;
        }, base);
      } catch (error) {
        sample.error = error instanceof Error ? error.message : String(error);
        trace(sample.error);
      }
      sample.durationMs = round(performance.now() - started);
      sample.snapshotTokens = snapshots.reduce((sum, text) => sum + encode(text).length, 0);
      samples.push(sample);
    }
  }
  const probes = await verifyLifecycle();
  await runtime.shutdown();
  const report = {
    fixtureRepetitions: repetitions,
    platform: `${process.platform}/${process.arch}`,
    tokenizer: 'gpt-tokenizer gpt-4o / o200k_base',
    summary: summarize(samples),
    tasks: Object.fromEntries(Object.keys(fixtures).map((task) => [
      task, summarize(samples.filter((sample) => sample.task === task)),
    ])),
    probes, samples,
  };
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...report, samples: samples.filter((sample) => sample.error) }, null, 2));
  if (samples.some((sample) => sample.error)) process.exitCode = 1;
} finally {
  slowResponse?.destroy();
  try {
    await runtime.shutdown();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function verifyLifecycle() {
  const first = observed(await runtime.execute('alpha', { action: 'navigate', url: base + '/storage?write' }));
  assert(find(first, 'alpha poc=alpha'));
  const second = observed(await runtime.execute('beta', { action: 'navigate', url: base + '/storage' }));
  assert.notEqual(first.sessionId, second.sessionId);
  assert(find(second, 'empty empty'));
  const foreign = await runtime.execute('beta', { action: 'observe', sessionId: first.sessionId });
  assert(!foreign.ok && foreign.error.code === 'SESSION_NOT_FOUND');
  const foreignTab = await runtime.execute('beta', { action: 'tabs', operation: 'activate', tabId: first.tabId });
  assert(!foreignTab.ok && foreignTab.error.code === 'TARGET_NOT_FOUND');

  const controller = new AbortController();
  const slowRequested = new Promise<void>((resolve) => { notifySlowRequest = resolve; });
  const pending = runtime.execute('alpha', { action: 'navigate', url: base + '/slow' }, controller.signal);
  await Promise.race([slowRequested, pending.then(() => { throw new Error('Navigation ended before reaching the slow fixture.'); })]);
  const started = performance.now();
  controller.abort();
  const result = await pending;
  const abortMs = round(performance.now() - started);
  assert(!result.ok && result.error.code === 'ABORTED');
  assert(closedSessions.has(first.sessionId), 'Aborted session must be retired.');
  assert(slowResponse?.destroyed, 'Pending navigation must disconnect.');
  const oldSession = await runtime.execute('alpha', { action: 'observe', sessionId: first.sessionId, visual: 'never' });
  assert(!oldSession.ok && oldSession.error.code === 'SESSION_NOT_FOUND');
  const survivor = observed(await runtime.execute('beta', { action: 'observe', sessionId: second.sessionId, visual: 'never' }));
  assert.equal(survivor.sessionId, second.sessionId);
  const recovered = observed(await runtime.execute('alpha', { action: 'navigate', url: base + '/storage' }));
  assert.notEqual(recovered.sessionId, first.sessionId);
  assert(find(recovered, 'empty empty'));

  const delayed = observed(await runtime.execute('alpha', { action: 'navigate', url: base + '/delayed' }));
  const verified = observed(await runtime.execute('alpha', {
    action: 'click', ref: find(delayed, 'Start'), revision: delayed.revision, expect: { textIncludes: 'Ready' },
  }));
  assert(find(verified, 'Ready'));
  assert.equal(verified.changes.changed[0]?.name, 'Ready');

  return {
    storageIsolated: true, foreignSessionRejected: true, foreignTabRejected: true,
    abortMs, httpDisconnected: true, sessionRetired: true, peerSurvived: true,
    newSessionOpened: true, delayedExpectationVerified: true,
  };
}

function receipt(result: BrowserControlResult) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.receipt;
}

function observed(result: BrowserControlResult): BrowserObservation {
  const observation = receipt(result).observation;
  assert(observation);
  return observation;
}

function find(page: BrowserObservation, name: string): string {
  const node = page.nodes.find((entry) => entry.name === name);
  assert(node, `Missing ${name} (available: ${page.nodes.map((entry) => entry.name).join(', ')})`);
  return node.ref;
}

function summarize(samples: Sample[]) {
  const successful = samples.filter((sample) => !sample.error);
  const durations = successful.map((sample) => sample.durationMs).sort((a, b) => a - b);
  return {
    successes: successful.length, total: samples.length,
    p95Ms: durations[Math.ceil(durations.length * 0.95) - 1] ?? null,
    meanSnapshotTokens: successful.length
      ? round(successful.reduce((sum, sample) => sum + sample.snapshotTokens, 0) / successful.length)
      : null,
  };
}

function round(value: number): number { return Math.round(value * 10) / 10; }
