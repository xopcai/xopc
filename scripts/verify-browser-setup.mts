// Isolated real-Chrome smoke test. Enrollment/native-host/Realtime transport use a test adapter;
// the setup service, Agent tools, BrowserRuntime and extension CDP controller are production code.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { serve } from '@hono/node-server';
import { build } from 'esbuild';
import type { BrowserContext } from 'playwright-core';
const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
import { BROWSER_EXTENSION_PROTOCOL_VERSION, type BrowserActionInput, type BrowserControlResult } from '@xopcai/browser-control-contract';

import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { createBrowserUseTool } from '../src/agent/tools/browser/tool/browser-use-tool.js';
import { createXopcUseTool } from '../src/agent/tools/xopc-use-tool.js';
import { BrowserSetupService } from '../src/browser/setup/service.js';
import { readBrowserSetup } from '../src/browser/setup/repository.js';
import { ExtensionDriver } from '../src/browser/drivers/extension-driver.js';
import { BrowserRuntime } from '../src/browser/runtime/browser-runtime.js';
import { ConfigSchema } from '../src/config/schema.js';
import type { EndpointToolRuntime } from '../src/endpoint-tools/index.js';
import { createHonoApp } from '../src/gateway/hono/app.js';
import type { GatewayService } from '../src/gateway/service.js';
import { openXopcDatabase, closeXopcDatabase } from '../src/storage/sqlite/connection.js';
import { createConversation } from '../src/storage/sqlite/conversation-repository.js';

const directory = await mkdtemp(join(tmpdir(), 'xopc-browser-live-'));
process.env.XOPC_STATE_DIR = directory;
let context: BrowserContext | undefined;
let runtime: BrowserRuntime | undefined;
let gateway: ReturnType<typeof serve> | undefined;
try {
  openXopcDatabase({ path: join(directory, 'xopc.db') });
  seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: directory }] });
  const conversation = createConversation({ agentId: 'main' }, directory);
  const extension = join(directory, 'extension'); await mkdir(extension);
  await writeFile(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'xopc isolated Browser setup test', version: '1.0',
    background: { service_worker: 'worker.js', type: 'module' }, permissions: ['debugger', 'tabs', 'tabGroups', 'storage'], host_permissions: ['<all_urls>'] }));
  await build({ stdin: { contents: `import {executeBrowserCommand} from ${JSON.stringify(resolve('packages/browser-ext/src/controller.ts'))}; globalThis.runBrowserCommand = executeBrowserCommand;`, resolveDir: process.cwd() },
    bundle: true, format: 'esm', platform: 'browser', outfile: join(extension, 'worker.js') });
  context = await chromium.launchPersistentContext(join(directory, 'profile'), { channel: 'chromium', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 20_000 });
  const send = async (input: BrowserActionInput): Promise<BrowserControlResult> => {
    const wire = await worker.evaluate(async ({ input, version }) => {
      const host = globalThis as unknown as { runBrowserCommand: (command: unknown) => Promise<{ result: unknown }> };
      return host.runBrowserCommand({ id: crypto.randomUUID(), connectionId: 'test-transport', protocolVersion: version, input, timeoutMs: 15_000, visualFallback: false });
    }, { input, version: BROWSER_EXTENSION_PROTOCOL_VERSION });
    return wire.result as BrowserControlResult;
  };
  const endpoint = { endpointId: 'chrome-live', principalId: 'device-live', displayName: 'Isolated Chrome', kind: 'browser', appVersion: 'test', tools: [{ descriptor: { name: 'browser.control' } }] };
  const auth = { mode: 'token' as const, token: crypto.randomUUID() };
  let config = ConfigSchema.parse({ gateway: { bind: 'loopback', auth }, browser: { enabled: false, driver: { kind: 'extension' } } });
  const setupService = new BrowserSetupService({ getConfig: () => config, saveConfig: async next => { config = next; return { saved: true }; },
    endpoints: { registry: { list: () => [endpoint] } } as unknown as EndpointToolRuntime,
    canUseBrowser: () => true, prepare: async () => ({}), doctor: async () => ({ installed: true, nativeHost: { installed: true } }), open: async () => ({}),
    release: (endpointId, sessionId) => send({ action: 'close', sessionId, target: { kind: 'endpoint', endpointId } }),
  });
  const service = { get currentConfig() { return config; }, getResolvedAuth: () => auth, getEffectiveListenPort: () => 18790,
    get browserSetup() { return setupService; }, getExtensionLoader: () => null, isGatewayReady: () => true, getHealth: () => ({ status: 'healthy' }) } as unknown as GatewayService;
  const app = createHonoApp({ service });
  gateway = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!gateway.listening) await once(gateway, 'listening');
  const address = gateway.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (action: string, args: Record<string, unknown> = {}) => {
    const response = await fetch(`${base}/api/browser/setup`, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: conversation.key, action, ...args }) });
    const data = await response.json() as { payload: { id: string; revision: number }; error?: unknown };
    assert(response.ok, JSON.stringify(data)); return data.payload;
  };
  const product = createXopcUseTool({ getBrowserSetupService: () => setupService, getCurrentAgentId: () => 'main', getCurrentConversationId: () => conversation.key });
  const started = await product.execute('start', { mode: 'browser_setup', command: 'start' }, undefined as never, undefined as never);
  const setupId = (started.details.result as { id: string }).id;
  const current = readBrowserSetup(setupId)!;
  await request('approve', { setupId, expectedRevision: current.revision });
  await request('prepare', { setupId });
  let ready = readBrowserSetup(setupId)!;
  await request('begin_verification', { setupId, endpointId: endpoint.endpointId, expectedRevision: ready.revision });
  const driver = new ExtensionDriver({ start: async () => {}, waitForConnection: async () => {},
    send: async input => ({ id: crypto.randomUUID(), connectionId: endpoint.endpointId, result: await send(input) }) }, 15_000, false, async () => {});
  runtime = new BrowserRuntime({ getConfig: () => config.browser, createDriver: async () => driver,
    isTrustedSetupUrl: (key, url) => setupService.allowsVerificationUrl(key, url), canRestoreSetupSession: (key, id) => setupService.canRestoreSession(key, id) });
  const browser = createBrowserUseTool({ getRuntime: () => runtime!, getTaskId: () => conversation.key, getAgentId: () => 'main', getSetupService: () => setupService });
  const call = async (input: BrowserActionInput) => {
    const result = await browser.execute('live', input, undefined as never, undefined as never);
    assert(result.details.ok, JSON.stringify(result.details));
    return result.details.receipt as { observation?: { revision: number; nodes: Array<{ name: string; ref: string }> } };
  };
  const attempt = readBrowserSetup(setupId)!.attempt!;
  let receipt = await call({ action: 'navigate', url: attempt.fixtureUrl });
  const find = (name: string) => { const node = receipt.observation?.nodes.find(n => n.name === name); assert(node, `Missing ${name}: ${JSON.stringify(receipt.observation)}`); return node; };
  receipt = await call({ action: 'click', revision: receipt.observation!.revision, ref: find('Test click').ref });
  receipt = await call({ action: 'fill', revision: receipt.observation!.revision, ref: find('Test input').ref, value: attempt.sample });
  await call({ action: 'close' });
  ready = readBrowserSetup(setupId)!;
  assert.equal(ready.state, 'completed', JSON.stringify(setupService.view(ready)));
  assert(ready.attempt?.released);
  assert.equal(context.pages().filter(p => p.url().includes('browser-setup-test')).length, 0);
  const report = { ok: true, browser: await context.browser()?.version(), checks: setupService.view(ready).checks,
    coverage: ['authenticated lazy Gateway route', 'xopc_use start', 'real browser_use tool', 'BrowserRuntime policy', 'Chrome extension CDP controller', 'real demo DOM read/click/fill', 'verified session release'],
    boundaries: ['isolated controller transport adapter; production enrollment/native host/Realtime and a live language model are not exercised', 'installation helpers are covered separately; this smoke loads the isolated test extension through Chromium launch flags'] };
  const output = resolve(process.env.XOPC_BROWSER_SETUP_REPORT || '/tmp/xopc-browser-setup-live.json');
  await writeFile(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, output }));
} finally {
  await runtime?.shutdown(); await context?.close();
  gateway?.closeAllConnections(); if (gateway) await new Promise<void>(r => gateway!.close(() => r()));
  closeXopcDatabase();
  await rm(directory, { recursive: true, force: true });
}

// Gateway modules own background timers; this standalone verifier must not outlive its isolated state.
process.exit(0);
