import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import tailwindcss from '@tailwindcss/vite';
import playwright from 'playwright-core';
import { createServer } from 'vite';

import { ConfigSchema } from '../src/config/schema.js';
import {
  claimNextSessionInput, closeXopcDatabase, consumeClarificationApproval, consumeClarificationResume,
  createClarificationWait, ensureSessionRecord, finishSessionInputRun, getClarification, getClarificationSnapshot,
  getSessionInputState, insertSessionInput, openXopcDatabase, resolveClarification,
} from '../src/storage/sqlite/index.js';
import type { GatewayService } from '../src/gateway/service.js';
import { createHonoApp } from '../src/gateway/hono/app.js';

// Controlled host execution, real Web component/hook, HTTP auth/lazy routing, SQLite and resume queue.
const { chromium } = playwright;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = await mkdtemp(path.join(tmpdir(), 'xopc-clarify-browser-'));
const fixture = path.join(root, 'web', `.clarify-fixture-${process.pid}`);
const webRequire = createRequire(path.join(root, 'web/package.json'));
const { default: react } = await import(webRequire.resolve('@vitejs/plugin-react'));
openXopcDatabase({ path: path.join(output, 'xopc.db') });
const ids = { compose: '5f8923f9-52c1-47a6-8174-bfe092661691', quick: '5f8923f9-52c1-47a6-8174-bfe092661692',
  custom: '5f8923f9-52c1-47a6-8174-bfe092661693', approval: '5f8923f9-52c1-47a6-8174-bfe092661694' };
const waits: Record<string, ReturnType<typeof createClarificationWait>> = {};
const resumed = new Map<string, string>();
for (const [scenario, conversationId] of Object.entries(ids)) {
  ensureSessionRecord(conversationId, output, { agentId: 'main' });
  insertSessionInput({ id: conversationId + '-input', conversationId, clientMessageId: conversationId + '-origin', content: 'Deploy service',
    requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin: { type: 'system', source: 'internal' } });
  claimNextSessionInput(conversationId, conversationId + '-run');
  waits[scenario] = createClarificationWait({ conversationId, runId: conversationId + '-run', toolCallId: 'clarify',
    kind: scenario === 'approval' ? 'approval' : 'input', question: scenario === 'approval' ? 'Allow deploy to run once?' : '部署到哪里？',
    ...(scenario === 'approval' ? { approvalKey: 'deploy-exact', approval: { operation: 'Deploy service', target: 'Production', impact: 'Updates the live service' } }
      : scenario === 'custom' ? { choiceDetails: [{ id: '测试环境', label: '测试环境' }, { id: '生产环境', label: '生产环境' }] }
        : { interactionMode: scenario === 'compose' ? 'compose' : 'quick', choiceDetails: [
          { id: 'stage', label: '测试环境', description: '用于验收，不影响线上用户' }, { id: 'prod', label: '生产环境', description: '面向正式用户' }], recommendedChoiceId: 'stage' }),
  });
  finishSessionInputRun(conversationId, conversationId + '-run', 'suspended');
}
const auth = { mode: 'token' as const, token: 'clarify-browser-fixture-token' };
const service = { currentConfig: ConfigSchema.parse({ gateway: { auth } }), getResolvedAuth: () => auth,
  getEffectiveListenPort: () => 18790, isGatewayReady: () => true, getHealth: () => ({ status: 'healthy' }),
  getClarificationState: getClarificationSnapshot, getSessionInputState,
  resolveClarificationResponse(input: Parameters<typeof resolveClarification>[0]) {
    const result = resolveClarification(input);
    if (result.ok && result.queued && !result.idempotent) {
      const conversationId = result.clarification.conversationId;
      const next = claimNextSessionInput(conversationId, conversationId + '-resume');
      assert(next); resumed.set(conversationId, next.content);
      if (result.clarification.kind === 'approval') assert.equal(consumeClarificationApproval(conversationId, 'deploy-exact'), 'approved');
      assert(consumeClarificationResume(next));
      finishSessionInputRun(conversationId, conversationId + '-resume', 'completed');
    }
    return result;
  },
} as unknown as GatewayService;
const app = createHonoApp({ service });
const gateway = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  if (!gateway.listening) await once(gateway, 'listening');
  const address = gateway.address(); assert(address && typeof address !== 'string');
  await mkdir(fixture);
  await writeFile(path.join(fixture, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
  await writeFile(path.join(fixture, 'entry.tsx'), `
import React, { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ClarifyPrompt } from '@/features/chat/composer/clarify-prompt';
import { useChatFollowUpClarify } from '@/features/chat/session/use-chat-follow-up-clarify';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
useGatewayStore.getState().setBrowserSession('clarify-fixture-browser-session');
import '@/styles/globals.css';
const params = new URLSearchParams(location.search);
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark');
function App() {
  const conversationId = params.get('id');
  const conversationIdRef = useRef(conversationId), sendingRef = useRef(false), streamingRef = useRef(false);
  const clarify = useChatFollowUpClarify({ conversationId, decodedKey: conversationId ?? undefined, conversationIdRef, sendingRef, streamingRef,
    modelSupportsThinking: false, thinkingLevel: 'off', shouldApplyStreamUpdate: () => true });
  return <main style={{ width: '100%', maxWidth: 672, margin: '0 auto', padding: 16 }}><ClarifyPrompt prompt={clarify.clarifyPrompt} submitting={clarify.clarifySubmitting}
    submitError={clarify.clarifySubmitError} labels={messages('zh').chat} onSubmit={clarify.submitClarifyAnswer}
    onAgentDecide={clarify.letAgentDecideClarification} onCancel={clarify.cancelClarification} /></main>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><App /></MemoryRouter>);
`);
  server = await createServer({ root: path.join(root, 'web'), configFile: false,
    plugins: [react(), tailwindcss()], resolve: { alias: { '@': path.join(root, 'web/src') } },
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: `http://127.0.0.1:${address.port}`, headers: { Authorization: `Bearer ${auth.token}` } } } } });
  await server.listen();
  const executablePath = process.env.CHROME_EXECUTABLE_PATH || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const origin = server.resolvedUrls!.local[0];
  const open = async (scenario: keyof typeof ids, theme = 'light') => {
    await page.goto(`${origin}${path.basename(fixture)}/index.html?id=${ids[scenario]}&theme=${theme}`, { waitUntil: 'networkidle' });
    await page.locator('[data-clarification-id]').waitFor();
  };
  console.log('Checking compose and lost-response retry');
  await open('compose');
  await page.getByRole('button', { name: /^生产环境/ }).click();
  assert.equal(getClarification(waits.compose.id)?.status, 'open');
  await page.getByRole('textbox').fill('今晚 22:00 后执行\n部署前先备份');
  await page.screenshot({ path: path.join(output, 'compose-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('[data-clarification-id]').count(), 1);
  await page.screenshot({ path: path.join(output, 'compose-mobile.png'), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  // A lost response must preserve text and selection, and the same idempotency key must safely retry.
  let lost = true; const attempts: string[] = [];
  await page.route('**/api/clarifications/*/responses', async route => {
    const body = route.request().postDataJSON(); attempts.push(body.idempotencyKey);
    if (lost) { lost = false; await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('textbox').inputValue(), '今晚 22:00 后执行\n部署前先备份');
  assert.equal(await page.getByRole('button', { pressed: true }).count(), 1);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.locator('[data-clarification-id]').waitFor({ state: 'detached' });
  assert.equal(attempts.length, 2); assert.equal(attempts[0], attempts[1]);
  assert(resumed.get(ids.compose)?.includes('Choice: 生产环境\nAdditional information: 今晚 22:00 后执行\n部署前先备份'));
  assert.equal(getClarification(waits.compose.id)?.status, 'resolved');
  await page.unroute('**/api/clarifications/*/responses');
  console.log('Checking quick choices in dark mode');
  await open('quick', 'dark');
  await page.screenshot({ path: path.join(output, 'quick-dark-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: /^测试环境/ }).click();
  await page.locator('[data-clarification-id]').waitFor({ state: 'detached' });
  assert.equal(getClarification(waits.quick.id)?.answer, '测试环境');
  console.log('Checking custom question');
  await open('custom'); await page.getByRole('textbox').fill('自定义环境');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.locator('[data-clarification-id]').waitFor({ state: 'detached' });
  assert.equal(getClarification(waits.custom.id)?.answer, '自定义环境');
  console.log('Checking approval');
  await open('approval');
  assert.equal(await page.getByRole('textbox').count(), 0);
  assert.equal(await page.getByRole('button', { name: '让助手自行判断' }).count(), 0);
  await page.screenshot({ path: path.join(output, 'approval-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '批准本次操作', exact: true }).click();
  await page.locator('[data-clarification-id]').waitFor({ state: 'detached' });
  assert.equal(getClarification(waits.approval.id)?.decision, 'approve');
  assert.equal(consumeClarificationApproval(ids.approval, 'deploy-exact'), undefined);
  assert.deepEqual(errors, []);
  console.log(`Clarify browser lifecycle passed: compose, lost-response retry, quick, custom and approval. Screenshots: ${output}`);
} finally {
  await browser?.close(); await server?.close();
  await new Promise<void>(resolve => gateway.close(() => resolve()));
  closeXopcDatabase(); await rm(fixture, { recursive: true, force: true });
}
