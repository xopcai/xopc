import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { browserDom, type BrowserRecordingEvent } from '@xopcai/browser-control-contract';

import { ConfigSchema } from '../../../config/schema.js';
import { BrowserRuntime } from '../../runtime/browser-runtime.js';
import { PlaywrightDriver } from '../../drivers/playwright-driver.js';
import { runBrowserAutomation } from '../../automations/runner.js';
import { compileRecording } from '../service.js';

const server = createServer((request, response) => {
  const url = new URL(request.url!, 'http://localhost');
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (url.pathname === '/result') response.end(`<title>Result</title><p>Order found</p>`);
  else response.end(`<title>Orders</title><form aria-label="Order lookup" action="/result"><label>Order<input name="query"></label><label>Password<input type="password" name="password"></label><label>Code<input autocomplete="one-time-code" name="code"></label><button>Find</button></form><form aria-label="Other"><label>Order<input></label><button type="button">Find</button></form>`);
});
let browser: Browser;
let base: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
});
afterAll(async () => { await browser?.close(); await new Promise<void>((resolve) => server.close(() => resolve())); });

describe('real browser recording and replay', () => {
  it('records Enter submission once when Chrome also dispatches an implicit button click', async () => {
    const context = await browser.newContext();
    const events: BrowserRecordingEvent[] = [];
    await context.exposeBinding('recordEvent', (_source, message) => {
      events.push({ ...message.event, seq: events.length + 1 });
      return { ok: true };
    });
    await context.addInitScript(() => {
      (globalThis as any).chrome = { runtime: { sendMessage: (message: unknown) => (globalThis as any).recordEvent(message) } };
    });
    const page = await context.newPage();
    await page.goto(base);
    await page.evaluate(() => { document.querySelector('form')!.addEventListener('submit', (event) => event.preventDefault()); });
    await page.evaluate(browserDom, { operation: 'record', recordingId: randomUUID(), generation: 1 });
    const field = page.getByRole('form', { name: 'Order lookup' }).getByRole('textbox', { name: 'Order', exact: true });
    await field.fill('Enter order');
    await field.press('Enter');
    await page.evaluate(browserDom, { operation: 'stop' });
    expect(events.filter((event) => event.action === 'press')).toHaveLength(1);
    expect(events.filter((event) => event.action === 'click')).toHaveLength(0);
    expect(compileRecording(randomUUID(), events).steps.map((step) => step.action)).toEqual(['navigate', 'fill', 'press']);
    await context.close();
  });
  it('persists simultaneous events without lost sequences and recovers after a page restart', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(base);
    const source = stripTypeScriptTypes(readFileSync(resolve('packages/browser-ext/src/recording/store.ts'), 'utf8'), { mode: 'transform' });
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    const id = randomUUID();
    const loadStore = async () => {
      await page.addScriptTag({ type: 'module', content: `import * as store from ${JSON.stringify(moduleUrl)};globalThis.recordingStore=store;` });
      await page.waitForFunction(() => !!(globalThis as any).recordingStore);
    };
    await loadStore();
    const initial = await page.evaluate(async ({ moduleUrl, id }) => {
      const store = (globalThis as any).recordingStore;
      await store.saveRecording({ id, state: 'recording', tabId: 1, generation: 1, count: 0, ack: 0, bytes: 0, gatewayId: 'gateway', deviceId: 'device', createdAtMs: Date.now() });
      await Promise.all(Array.from({ length: 20 }, (_, index) => store.appendRecordingEvent(id, 1, 1,
        { id: crypto.randomUUID(), documentId: 'document', sourceSeq: index + 1, action: 'navigate', url: location.href })));
      await store.patchRecording(id, { ack: 7 });
      return { session: (await store.recordings())[0], events: await store.recordingEvents(id) };
    }, { moduleUrl, id });
    expect(initial.session.count).toBe(20);
    expect(initial.events.map((event: BrowserRecordingEvent) => event.seq)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    await page.reload();
    await loadStore();
    const restored = await page.evaluate(async ({ moduleUrl, id }) => {
      const store = (globalThis as any).recordingStore;
      await store.patchRecording(id, { state: 'stopped' });
      let rejected = false;
      try { await store.appendRecordingEvent(id, 1, 1, { id: crypto.randomUUID() }); } catch { rejected = true; }
      return { session: (await store.recordings())[0], remaining: await store.recordingEvents(id, 7), rejected };
    }, { moduleUrl, id });
    expect(restored.session).toMatchObject({ count: 20, ack: 7, state: 'stopped' });
    expect(restored.remaining).toHaveLength(13);
    expect(restored.rejected).toBe(true);
    await context.close();
  });
  it('records Chinese inputs, excludes secrets, scopes duplicate targets and replays the compiled flow', async () => {
    const context = await browser.newContext();
    const events: BrowserRecordingEvent[] = [];
    await context.exposeBinding('recordEvent', (_source, message) => {
      events.push({ ...message.event, seq: events.length + 1 });
      return { ok: true };
    });
    await context.addInitScript(() => {
      (globalThis as any).chrome = { runtime: { sendMessage: (message: unknown) => (globalThis as any).recordEvent(message) } };
    });
    const page = await context.newPage();
    await page.goto(base);
    await page.evaluate(browserDom, { operation: 'record', recordingId: randomUUID(), generation: 1 });
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('do-not-record');
    await page.getByRole('textbox', { name: 'Code', exact: true }).fill('654321');
    await page.getByRole('form', { name: 'Order lookup' }).getByRole('textbox', { name: 'Order', exact: true }).fill('中文订单');
    await page.getByRole('form', { name: 'Order lookup' }).getByRole('button', { name: 'Find' }).click();
    await page.waitForURL('**/result?**');
    await page.evaluate(browserDom, { operation: 'record', recordingId: randomUUID(), generation: 2 });
    await page.evaluate(browserDom, { operation: 'stop' });
    expect(JSON.stringify(events)).not.toContain('do-not-record');
    expect(JSON.stringify(events)).not.toContain('654321');
    expect(events.find((item) => item.action === 'fill')?.value).toBe('中文订单');
    const definition = compileRecording(randomUUID(), events);
    definition.successCriteria = [{ field: 'title', equals: 'Result' }];
    definition.outputs = { result: { field: 'text', target: { role: 'text', name: 'Order found' } } };
    const driver = new PlaywrightDriver({ connect: async () => ({ browser, context }), maxNodes: 500, maxCharacters: 10000, visualFallback: false, actionTimeoutMs: 3000 });
    const config = ConfigSchema.parse({ browser: { enabled: true, security: { allowedPrivateHosts: ['127.0.0.1'] } } });
    const runtime = new BrowserRuntime({ getConfig: () => config.browser, createDriver: async () => driver });
    const result = await runBrowserAutomation({ definition, inputs: {}, runtime, taskKey: 'replay', signal: new AbortController().signal, onStep: () => {} });
    expect(result).toMatchObject({ ok: true, receipt: { verified: true, outputs: { result: 'Order found' } } });
    await runtime.closeTaskSession('replay');
    await context.close();
  });
});
