// Live opening acceptance against an explicitly selected local Gateway.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const webRoot = fileURLToPath(new URL('../web', import.meta.url));
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { createServer } = await import(require.resolve('vite'));
assert(process.env.XOPC_CONFIG_PATH, 'Set XOPC_CONFIG_PATH to the test Gateway config');
const config = JSON.parse(await readFile(process.env.XOPC_CONFIG_PATH, 'utf8'));
const gateway = `http://127.0.0.1:${config.gateway.port}`;
const headers = { Authorization: `Bearer ${config.gateway.auth.token}` };
const personalResponse = await fetch(gateway + '/api/personal-agent', { headers });
assert(personalResponse.ok, 'Personal AI lookup failed');
const { payload: personal } = await personalResponse.json();
assert(personal?.state === 'ready' && personal.voiceCallPreferences.openingGreetingEnabled,
  'The test Gateway must have a ready Personal AI with opening greetings enabled');
const dir = await mkdtemp(webRoot + '/.voice-opening-live-');
let server, browser;
try {
  // Silent input isolates the automatic opening from user turns and echo.
  const wav = Buffer.alloc(44 + 48_000 * 2 * 60);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48_000, 24); wav.writeUInt32LE(96_000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  await writeFile(dir + '/microphone.wav', wav);
  await writeFile(dir + '/index.html', '<div id="root"></div><script type="module" src="./main.jsx"></script>');
  await writeFile(dir + '/main.jsx', `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';
import{VoiceCallProvider}from'/src/features/voice/realtime/voice-call-provider';import{useVoiceCall}from'/src/features/voice/realtime/voice-call-context';import{useLocaleStore}from'/src/stores/locale-store';import{initGatewayFromWindow}from'/src/stores/gateway-store';import'/src/styles/globals.css';
useLocaleStore.setState({language:'zh'});await initGatewayFromWindow();
function Harness(){const call=useVoiceCall();return <button onClick={()=>call.open({conversationId:window.__conversationId,name:'Loopi',mode:'assistant'})}>Opening acceptance</button>}
createRoot(document.getElementById('root')).render(<MemoryRouter><VoiceCallProvider><Harness/></VoiceCallProvider></MemoryRouter>);`);
  process.chdir(webRoot);
  server = await createServer({ configFile: webRoot + '/vite.config.ts', root: webRoot,
    server: { port: 3017, strictPort: true, open: false, proxy: { '/api': {
      target: gateway, changeOrigin: true, ws: true,
      configure(proxy) { proxy.on('proxyReq', req => req.setHeader('origin', gateway)); },
    } } } });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.XOPC_VOICE_SMOKE_BROWSER ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--use-file-for-fake-audio-capture=' + dir + '/microphone.wav'] });
  const results = [];
  for (const captureDelayMs of [0, 1500]) {
    const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1024, height: 900 } });
    const auth = await context.request.post('http://localhost:3017/api/browser-session', { headers });
    assert(auth.ok(), 'Browser authentication failed');
    const page = await context.newPage();
    await page.addInitScript(({ conversationId, delay }) => {
      window.__conversationId = conversationId;
      window.__playback = { buffers: 0, nonzero: 0, suspended: 0, firstStart: null, captureResumed: null, lastOutputResume: null, peak: 0 };
      const resume = AudioContext.prototype.resume;
      AudioContext.prototype.resume = async function (...args) {
        const result = await resume.apply(this, args);
        if (this.sampleRate === 24000) window.__playback.lastOutputResume = performance.now();
        else window.__playback.captureResumed = performance.now();
        return result;
      };
      const addModule = AudioWorklet.prototype.addModule;
      AudioWorklet.prototype.addModule = async function (...args) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        return addModule.apply(this, args);
      };
      const start = AudioBufferSourceNode.prototype.start;
      const observed = new WeakSet();
      AudioBufferSourceNode.prototype.start = function (...args) {
        const p = window.__playback;
        p.buffers++;
        if (this.buffer.getChannelData(0).some(value => Math.abs(value) > 0.00001)) p.nonzero++;
        if (this.context.state !== 'running') p.suspended++;
        p.firstStart ??= performance.now();
        // Measure rendered output energy, independently of received PCM samples.
        if (!observed.has(this.context)) {
          observed.add(this.context);
          const analyser = this.context.createAnalyser();
          analyser.fftSize = 256;
          const tap = this.context.createGain(); tap.gain.value = 0;
          analyser.connect(tap); tap.connect(this.context.destination);
          window.__audioAnalyser = analyser;
          const samples = new Float32Array(analyser.fftSize);
          setInterval(() => {
            analyser.getFloatTimeDomainData(samples);
            for (const value of samples) p.peak = Math.max(p.peak, Math.abs(value));
          }, 10);
        }
        this.connect(window.__audioAnalyser);
        return start.apply(this, args);
      };
    }, { conversationId: personal.conversationId, delay: captureDelayMs });
    const errors = [], events = [], acknowledgements = [];
    let outputReadyAt, firstAudioAt, audioBytes = 0, frames = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('websocket', ws => {
      if (!ws.url().includes('/api/voice/realtime/')) return;
      ws.on('framesent', ({ payload }) => {
        if (typeof payload !== 'string') return;
        const message = JSON.parse(payload);
        if (message.type === 'session.output_ready') outputReadyAt = Date.now();
        if (message.type === 'response.audio.played') acknowledgements.push(message.payload);
      });
      ws.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string') {
          firstAudioAt ??= Date.now(); frames++;
          audioBytes += payload.readUInt32BE(28);
          return;
        }
        const event = JSON.parse(payload); events.push({ type: event.type, payload: event.payload });
        if (event.type === 'session.error') errors.push(event.payload.code + ': ' + event.payload.message);
      });
    });
    await page.goto('http://localhost:3017/' + dir.split('/').at(-1) + '/index.html');
    await page.getByRole('button', { name: 'Opening acceptance', exact: true }).click();
    const deadline = Date.now() + 45000;
    while (!events.some(event => event.type === 'response.done' || event.type === 'response.cancelled') && !errors.length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const playback = await page.evaluate(() => window.__playback);
    const done = events.find(event => event.type === 'response.done');
    const text = events.filter(event => event.type === 'response.text.delta').map(event => event.payload.delta).join('');
    const playedDurationMs = Math.max(0, ...acknowledgements.map(ack => ack.playedDurationMs));
    const result = { captureDelayMs, text, audioBytes, frames, playedDurationMs, expectedDurationMs: Math.floor(audioBytes / 48),
      outputReadyToFirstAudioMs: firstAudioAt - outputReadyAt, playback, done: done?.payload, events, errors };
    results.push(result);
    assert.equal(errors.length, 0, JSON.stringify(result));
    assert(done?.payload.audio && frames > 0, JSON.stringify(result));
    assert(firstAudioAt - outputReadyAt < 500, 'Prepared opening did not start promptly after output readiness');
    assert.equal(playback.buffers, frames, 'Some opening frames did not reach playback');
    assert.equal(playback.suspended, 0, 'Opening audio scheduled on suspended output');
    assert(playback.nonzero > 0 && playback.peak > 0.001, 'Opening produced no rendered audio energy');
    assert(playback.firstStart >= playback.captureResumed && playback.firstStart >= playback.lastOutputResume,
      'Opening started before capture/output readiness');
    assert.equal(playedDurationMs, Math.floor(audioBytes / 48), 'Opening playback was truncated');
    await page.getByRole('button', { name: '展开通话', exact: true }).click();
    await page.screenshot({ path: `/tmp/xopc-voice-opening-${captureDelayMs}.png` });
    await page.getByRole('button', { name: '挂断', exact: true }).click();
    await context.close();
  }
  const report = { passed: true, mode: process.env.XOPC_VOICE_E2E_MODE ?? 'live-cloud', results };
  await writeFile('/tmp/xopc-voice-opening-e2e.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close(); server?.httpServer?.closeAllConnections(); await server?.close();
  await rm(dir, { recursive: true, force: true });
}
