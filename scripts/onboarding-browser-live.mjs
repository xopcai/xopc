// Real onboarding component, authenticated Gateway, and account catalog; no model invocation.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

assert.ok(process.env.XOPC_CONFIG_PATH, 'Run with an isolated Gateway configuration');
const webRoot = fileURLToPath(new URL('../web', import.meta.url));
process.chdir(webRoot);
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { createServer } = await import(require.resolve('vite'));
const config = JSON.parse(await readFile(process.env.XOPC_CONFIG_PATH, 'utf8'));
const gateway = `http://127.0.0.1:${config.gateway.port}`;
const directory = await mkdtemp(join(webRoot, '.onboarding-live-'));
let server;
let browser;
try {
  await writeFile(join(directory, 'index.html'), '<html><body><div id="root"></div><script type="module" src="./main.jsx"></script></body></html>');
  await writeFile(join(directory, 'main.jsx'), `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';
import{OnboardingCard}from'/src/features/onboarding/onboarding-card';import{useGatewayStore}from'/src/stores/gateway-store';import{useLocaleStore}from'/src/stores/locale-store';import'/src/styles/globals.css';
window.electronAPI={platform:'darwin'};useGatewayStore.setState({conversationId:'onboarding-live'});useLocaleStore.setState({language:'zh'});
createRoot(document.getElementById('root')).render(<MemoryRouter><div style={{height:'100vh'}}><OnboardingCard onDismiss={()=>{}} onComplete={()=>{window.__onboardingDone=true}}/></div></MemoryRouter>);`);
  server = await createServer({ configFile: join(webRoot, 'vite.config.ts'), root: webRoot,
    server: { port: 3018, strictPort: true, open: false, proxy: { '/api': { target: gateway, changeOrigin: true, ws: true,
      configure(proxy) { proxy.on('proxyReq', req => req.setHeader('origin', gateway)); } } } } });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.XOPC_VOICE_SMOKE_BROWSER ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const authenticated = await context.request.post('http://localhost:3018/api/browser-session', { headers: { Authorization: `Bearer ${config.gateway.auth.token}` } });
  assert.ok(authenticated.ok(), 'Browser session authentication');
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const applications = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().endsWith('/api/models/setup/xopc-cloud/apply')) applications.push(request.postDataJSON()); });
  await page.goto(`http://localhost:3018/${directory.split('/').at(-1)}/index.html`);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.getByRole('heading', { name: '一切准备好了' }).waitFor();
  assert.equal(applications.length, 1);
  assert.deepEqual(applications[0].selected.sort(), ['background', 'chat', 'conversation', 'image', 'speech', 'transcription', 'vision']);
  assert.equal(applications[0].mode, 'replace');
  await page.getByRole('button', { name: '开始使用 XOPC', exact: true }).click();
  await page.waitForFunction(() => window.__onboardingDone === true);
  const saved = JSON.parse(await readFile(process.env.XOPC_CONFIG_PATH, 'utf8'));
  assert.equal(saved.computer.enabled, false);
  assert.equal(saved.voice.realtime.enabled, true);
  assert.equal(saved.tools.media.audio.enabled, true);
  assert.equal(saved.messages.tts.enabled, true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, selected: applications[0].selected, computerEnabled: saved.computer.enabled }));
} finally {
  await browser?.close();
  server?.httpServer?.closeAllConnections();
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
