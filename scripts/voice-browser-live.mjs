// Explicit live acceptance: real React capture/playback and real Gateway/cloud, with a speech fixture.
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const webRoot = fileURLToPath(new URL('../web', import.meta.url));
process.chdir(webRoot);
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { createServer } = await import(require.resolve('vite'));
const config = JSON.parse(await readFile(process.env.XOPC_CONFIG_PATH ?? process.env.XOPC_CONFIG ?? join(homedir(), '.xopc', 'xopc.json'), 'utf8'));
const gateway = `http://127.0.0.1:${config.gateway.port}`;
const headers = { Authorization: `Bearer ${config.gateway.auth.token}`, 'Content-Type': 'application/json' };
async function request(path, method = 'GET', body) {
  const response = await fetch(gateway + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(`${path}: ${response.status}: ${JSON.stringify(data.error)}`);
  return data.payload ?? data;
}
const agentId = process.argv[3] ?? 'main';
const agents = await request('/api/agents');
const model = agents.agents.find(agent => agent.id === agentId)?.effective?.models?.chat?.primary;
if (!model) throw new Error('Agent model unavailable');
const conversationId = crypto.randomUUID();
const dir = await mkdtemp(webRoot + '/.voice-live-');
let server, browser;
try {
  const body = { commandId: crypto.randomUUID(), purpose: 'voice', creation: { agentId, projectId: null, execution: null, temporary: true, model, thinkingLevel: 'off' } };
  let ready = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await request(`/api/sessions/${conversationId}/materialize`, 'POST', body);
    if (result.receipt?.lifecycle === 'ready') { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Diagnostic conversation did not become ready');
  const input = Buffer.concat([Buffer.alloc(32_000 * 8), await readFile(process.argv[2]), Buffer.alloc(32_000 * 3)]);
  const conversion = spawnSync(process.env.XOPC_VOICE_FFMPEG ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', '16000', '-ac', '1', '-i', 'pipe:0', '-ar', '48000', dir + '/microphone.wav'], { input });
  if (conversion.status !== 0) throw new Error('Could not prepare microphone WAV fixture');
  await writeFile(dir + '/index.html', '<html><body><div id="root"></div><script type="module" src="./main.jsx"></script></body></html>');
  await writeFile(dir + '/main.jsx', `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';
import{VoiceCallProvider}from'/src/features/voice/realtime/voice-call-provider';import{useVoiceCall}from'/src/features/voice/realtime/voice-call-context';import{useGatewayStore}from'/src/stores/gateway-store';import{useLocaleStore}from'/src/stores/locale-store';import'/src/styles/globals.css';
useGatewayStore.setState({conversationId:'live-voice-acceptance'});useLocaleStore.setState({language:'zh'});
function Harness(){const call=useVoiceCall();return <button onClick={()=>call.open({conversationId:window.__voiceConversation,name:'Loopi',mode:'assistant'})}>Live voice</button>}
createRoot(document.getElementById('root')).render(<MemoryRouter><VoiceCallProvider><Harness/></VoiceCallProvider></MemoryRouter>);`);
  server = await createServer({ configFile: webRoot + '/vite.config.ts', root: webRoot,
    server: { port: 3017, strictPort: true, open: false, proxy: { '/api': { target: gateway, changeOrigin: true, ws: true,
      configure(proxy) { proxy.on('proxyReq', req => req.setHeader('origin', gateway)); } } } } });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.XOPC_VOICE_SMOKE_BROWSER ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-audio-capture=' + dir + '/microphone.wav', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1024, height: 900 } });
  const authenticated = await context.request.post('http://localhost:3017/api/browser-session', { headers: { Authorization: headers.Authorization } });
  if (!authenticated.ok()) throw new Error('Browser authentication failed: ' + authenticated.status());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.addInitScript(id => {
    window.__voiceConversation = id; window.__voicePlayback = { buffers: 0, nonzero: 0, running: 0 };
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      const samples = this.buffer?.getChannelData(0);
      if (samples?.length) { window.__voicePlayback.buffers++; if (samples.some(sample => Math.abs(sample) > 0.00001)) window.__voicePlayback.nonzero++; }
      if (this.context.state === 'running') window.__voicePlayback.running++;
      return original.apply(this, args);
    };
  }, conversationId);
  const transcripts = [], replies = [], errors = [];
  let uplink = 0, downlink = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', ws => {
    if (!ws.url().includes('/api/voice/realtime/')) return;
    ws.on('framesent', ({ payload }) => { if (typeof payload !== 'string') uplink++; });
    ws.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') { downlink += payload.length; return; }
      const event = JSON.parse(payload);
      if (event.type === 'input.transcript.final') transcripts.push(event.payload.text);
      if (event.type === 'response.done') replies.push(event.payload);
      if (event.type === 'session.error') errors.push(event.payload.code + ': ' + event.payload.message);
    });
  });
  await page.goto('http://localhost:3017/' + dir.split('/').at(-1) + '/index.html');
  await page.getByRole('button', { name: 'Live voice', exact: true }).click();
  const deadline = Date.now() + 90_000;
  while (!replies.length && !errors.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
  const playback = await page.evaluate(() => window.__voicePlayback);
  if (errors.length || !transcripts.length || !replies.some(reply => reply.audio) || !uplink || !downlink || !playback.nonzero || !playback.running) {
    throw new Error(JSON.stringify({ errors, transcripts, replies, uplink, downlink, playback, ui: await page.locator('body').innerText() }));
  }
  await page.getByRole('button', { name: '挂断', exact: true }).click();
  console.log(JSON.stringify({ passed: true, agentId, transcripts, replies, uplink, downlink, playback }));
} finally {
  await browser?.close(); server?.httpServer?.closeAllConnections(); await server?.close(); await rm(dir, { recursive: true, force: true });
  await request(`/api/sessions/${conversationId}`, 'DELETE').catch(error => console.error('Diagnostic cleanup failed:', error.message));
}
