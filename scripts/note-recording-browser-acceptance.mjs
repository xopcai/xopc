// Real Chromium MediaRecorder/IndexedDB recovery with synthetic microphone input; no Gateway fixture.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../web', import.meta.url));
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { createServer } = await import(require.resolve('vite'));
const directory = await mkdtemp(join(tmpdir(), 'xopc-recording-browser-'));
const fixture = await mkdtemp(join(root, '.recording-acceptance-'));
const reportPath = resolve(process.env.XOPC_NOTE_BROWSER_REPORT ?? 'docs/design/technical/note-recording-browser-2026-10-15.json');
const durationMs = Number(process.env.XOPC_NOTE_BROWSER_DURATION_MS ?? 60_000);
assert.ok(Number.isFinite(durationMs) && durationMs >= 12_000 && durationMs <= 7_200_000);
process.chdir(root);
const report = { date: new Date().toISOString(), directory, durationMs, syntheticMicrophone: true, passed: false, checks: [], failure: undefined };
let server, context;
const errors = [];
const open = async () => {
  context = await chromium.launchPersistentContext(join(directory, 'profile'), {
    executablePath: process.env.XOPC_VOICE_SMOKE_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, permissions: ['microphone'],
    args: ['--enable-automation', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${join(directory, 'microphone.wav')}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(20_000);
  await page.addInitScript(() => {
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await capture(...args); window.testStream = stream; return stream; };
  });
  await page.goto(`${server.resolvedUrls.local[0]}${fixture.split('/').at(-1)}/index.html`);
  await page.getByRole('button', { name: 'Record', exact: true }).waitFor();
  return page;
};
try {
  execFileSync(process.env.XOPC_FFMPEG_PATH ?? 'ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5', '-c:a', 'pcm_s16le', join(directory, 'microphone.wav')]);
  await writeFile(join(fixture, 'index.html'), '<html><div id="root"></div><script type="module" src="./main.jsx"></script></html>');
  await writeFile(join(fixture, 'main.jsx'), `import React from 'react';import{createRoot}from'react-dom/client';
import{useDiscussionRecorder}from'/src/features/discussions/use-discussion-recorder';
import{listDiscussionDrafts,getDiscussionDraftChunk}from'/src/features/discussions/discussion-draft-store';
window.readSavedAudio=async(id)=>{const draft=(await listDiscussionDrafts()).find(d=>d.id===id);const blobs=[];for(let i=0;i<draft.chunkCount;i++){const chunk=await getDiscussionDraftChunk(id,i);if(!chunk)throw Error('Missing chunk '+i);blobs.push(chunk.blob)}const bytes=new Uint8Array(await new Blob(blobs).arrayBuffer());return{draft,bytes:Array.from(bytes)}};
function Harness(){const r=useDiscussionRecorder();window.recorder=r;return <><button onClick={()=>r.start({consentPolicyVersion:1,onLiveSegment:()=>{}})}>Record</button><button onClick={()=>r.stop()}>Stop</button><button onClick={()=>r.restore(r.recoverableDrafts[0])}>Restore</button><pre>{JSON.stringify({phase:r.phase,draft:r.draft,recoverable:r.recoverableDrafts,error:r.error})}</pre></>}
createRoot(document.getElementById('root')).render(<Harness/>);`);
  server = await createServer({ configFile: join(root, 'vite.config.ts'), root, server: { port: 0, open: false } }); await server.listen();
  let page = await open(); report.browser = context.browser().version();
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.waitForFunction(() => window.recorder.phase === 'recording');
  await page.waitForFunction(() => window.recorder.draft?.chunkCount >= 1);
  await context.setOffline(true);
  console.log(`Recording offline for ${durationMs} ms with real MediaRecorder`);
  await new Promise(done => setTimeout(done, durationMs));
  const before = await page.evaluate(async () => {
    const saved = await window.readSavedAudio(window.recorder.draft.id);
    const bytes = Uint8Array.from(saved.bytes);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    return { ...saved.draft, savedBytes: bytes.length, hash };
  });
  assert.ok(before.chunkCount >= 2); assert.ok(before.durationMs >= durationMs - 5_000);
  const cdp = await context.browser().newBrowserCDPSession();
  const command = await cdp.send('Browser.getBrowserCommandLine');
  assert.ok(command.arguments.some(argument => argument === `--user-data-dir=${join(directory, 'profile')}`));
  const processes = await cdp.send('SystemInfo.getProcessInfo');
  const browserProcess = processes.processInfo.find(process => process.type === 'browser'); assert.ok(browserProcess?.id);
  process.kill(browserProcess.id, 'SIGKILL');
  await context.close().catch(() => {}); context = undefined;
  console.log('Killed the browser process; reopening the same on-disk profile');
  page = await open();
  await page.waitForFunction(id => window.recorder.recoverableDrafts.some(draft => draft.id === id), before.id);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.waitForFunction(() => window.recorder.phase === 'stopped');
  const restored = await page.evaluate(id => window.readSavedAudio(id), before.id);
  assert.ok(restored.draft.chunkCount >= before.chunkCount); assert.ok(restored.draft.durationMs >= before.durationMs);
  assert.equal(createHash('sha256').update(Buffer.from(restored.bytes).subarray(0, before.savedBytes)).digest('hex'), before.hash);
  assert.equal(restored.draft.state, 'stopped');
  const recoveredPath = join(directory, 'recovered.webm'); await writeFile(recoveredPath, Buffer.from(restored.bytes));
  const decoded = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', recoveredPath], { encoding: 'utf8' }));
  execFileSync(process.env.XOPC_FFMPEG_PATH ?? 'ffmpeg', ['-v', 'error', '-y', '-i', recoveredPath, '-ar', '16000', '-ac', '1', join(directory, 'recovered.wav')]);
  const pcm = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', join(directory, 'recovered.wav')], { encoding: 'utf8' }));
  const decodedDurationMs = Number(pcm.format.duration) * 1000;
  assert.ok(Math.abs(decodedDurationMs - restored.draft.durationMs) < 1_000, 'Decoded duration must match committed metadata');
  report.checks.push({ scenario: 'offline capture, SIGKILL, browser restart, IndexedDB restore and audio decode',
    savedChunks: restored.draft.chunkCount, savedDurationMs: restored.draft.durationMs, decodedDurationMs,
    bytes: restored.bytes.length, prefixHash: before.hash, reportedContainerDuration: decoded.format?.duration });
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.waitForFunction(() => window.recorder.phase === 'recording');
  await page.waitForFunction(() => window.recorder.draft?.chunkCount >= 1);
  await page.evaluate(() => window.testStream.getTracks().forEach(track => track.stop()));
  await page.waitForFunction(() => window.recorder.phase === 'stopped');
  const interrupted = await page.evaluate(() => ({ ...window.recorder.draft }));
  assert.ok(interrupted.chunkCount >= 1); assert.equal(interrupted.state, 'stopped');
  report.checks.push({ scenario: 'all microphone tracks stop; MediaRecorder closes and saves tail', chunks: interrupted.chunkCount, durationMs: interrupted.durationMs });
  assert.deepEqual(errors, []); report.passed = true;
} catch (error) { report.failure = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
  await context?.close(); await server?.close(); await rm(fixture, { recursive: true, force: true });
  await mkdir(resolve(reportPath, '..'), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, reportPath, failure: report.failure }));
}
