// Real Chromium MediaRecorder/IndexedDB recovery; physical microphone is opt-in and stays local.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
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
const physicalMicrophone = process.env.XOPC_NOTE_BROWSER_PHYSICAL_MIC === '1';
const background = process.env.XOPC_NOTE_BROWSER_BACKGROUND === '1';
const durationMs = Number(process.env.XOPC_NOTE_BROWSER_DURATION_MS ?? 60_000);
assert.ok(Number.isFinite(durationMs) && durationMs >= 12_000 && durationMs <= 7_200_000);
process.chdir(root);
const report = { date: new Date().toISOString(), directory, durationMs, syntheticMicrophone: !physicalMicrophone, physicalMicrophone, background, passed: false, checks: [], failure: undefined };
let server, context, activePage, ownedBrowser;
const errors = [];
const open = async () => {
  const executablePath = process.env.XOPC_VOICE_SMOKE_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const audioArgs = !physicalMicrophone ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${join(directory, 'microphone.wav')}`] : [];
  if (background) {
    const profile = join(directory, 'profile'); await mkdir(profile, { recursive: true });
    await rm(join(profile, 'DevToolsActivePort'), { force: true });
    ownedBrowser = spawn(executablePath, [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--enable-automation', '--no-first-run', '--no-default-browser-check', ...audioArgs, 'about:blank'], { stdio: 'ignore' });
    let port;
    for (let attempt = 0; attempt < 100; attempt++) {
      port = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').then(text => Number(text.split('\n')[0])).catch(() => undefined);
      if (port) break;
      await new Promise(done => setTimeout(done, 100));
    }
    assert.ok(port, 'Owned native Chrome did not expose its debugging port');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    context = browser.contexts()[0]; await context.grantPermissions(['microphone']);
  } else {
    context = await chromium.launchPersistentContext(join(directory, 'profile'), {
      executablePath, headless: !physicalMicrophone, permissions: ['microphone'],
      args: ['--enable-automation', ...audioArgs, '--autoplay-policy=no-user-gesture-required'],
    });
  }
  const page = await context.newPage(); activePage = page; page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(20_000);
  // Native background tabs stop animation frames; assertions must use timer polling.
  const waitForFunction = page.waitForFunction.bind(page);
  page.waitForFunction = (fn, arg, options = {}) => waitForFunction(fn, arg, { polling: 100, ...options });
  await page.addInitScript(() => {
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await capture(...args); window.testStream = stream; return stream; };
  });
  await page.goto(`${server.resolvedUrls.local[0]}${fixture.split('/').at(-1)}/index.html`);
  await page.getByRole('button', { name: 'Record', exact: true }).waitFor();
  return page;
};
async function waitForTimedMarks(page,id) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const marks = await page.evaluate(id => window.readSavedMarks(id),id);
    if (marks.length && marks.every(row => row.annotation.anchor.offsetMs !== undefined)) return marks;
    await new Promise(done => setTimeout(done,100));
  }
  throw new Error('Highlight position did not reach durable storage');
}
try {
  if (!physicalMicrophone) execFileSync(process.env.XOPC_FFMPEG_PATH ?? 'ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5', '-c:a', 'pcm_s16le', join(directory, 'microphone.wav')]);
  await writeFile(join(fixture, 'index.html'), '<html><div id="root"></div><script type="module" src="./main.jsx"></script></html>');
  await writeFile(join(fixture, 'main.jsx'), `import React from 'react';import{createRoot}from'react-dom/client';
import{useDiscussionRecorder}from'/src/features/discussions/use-discussion-recorder';
import{listDiscussionDrafts,getDiscussionDraftChunk}from'/src/features/discussions/discussion-draft-store';
import{projectRecordingStatus}from'/src/features/discussions/recording-status';
import{RecordingStatusPanel}from'/src/features/discussions/recording-status-panel';
import{recordingRecoveryArchive}from'/src/features/discussions/recording-local-export';
import{listLocalAnnotations}from'/src/features/discussions/discussion-annotation-store';
window.readSavedMarks=listLocalAnnotations;
window.readRecoveryPackage=async(draft)=>{const parts=[];for await(const part of recordingRecoveryArchive(draft))parts.push(part);return Array.from(new Uint8Array(await new Blob(parts).arrayBuffer()))};
window.readEpochAudio=async(draft)=>{const result=[];for(let e=0;e<draft.epochs.length;e++){const parts=[];for(let i=draft.epochs[e].firstChunk;i<(draft.epochs[e+1]?.firstChunk??draft.chunkCount);i++)parts.push((await getDiscussionDraftChunk(draft.id,i)).blob);result.push(Array.from(new Uint8Array(await new Blob(parts).arrayBuffer())))}return result};
window.readSavedAudio=async(id)=>{const draft=(await listDiscussionDrafts()).find(d=>d.id===id);const blobs=[];for(let i=0;i<draft.chunkCount;i++){const chunk=await getDiscussionDraftChunk(id,i);if(!chunk)throw Error('Missing chunk '+i);blobs.push(chunk.blob)}const bytes=new Uint8Array(await new Blob(blobs).arrayBuffer());return{draft,bytes:Array.from(bytes)}};
function Harness(){const r=useDiscussionRecorder();window.recorder=r;const status=projectRecordingStatus({phase:r.phase,draft:r.draft,online:navigator.onLine,syncStage:'pending',pendingText:0,liveAvailable:r.liveTranscriptionAvailable});window.captureStatus=status;return <><button onClick={()=>r.start({consentPolicyVersion:1,onLiveSegment:()=>{}})}>Record</button><button onClick={()=>r.pause()}>Pause</button><button onClick={()=>r.resume()}>Resume</button><button onClick={()=>r.stop()}>Stop</button><button onClick={()=>r.restore(r.recoverableDrafts[0])}>Restore</button><RecordingStatusPanel status={status} language="en"/><pre>{JSON.stringify({phase:r.phase,draft:r.draft,recoverable:r.recoverableDrafts,error:r.error})}</pre></>}
createRoot(document.getElementById('root')).render(<Harness/>);`);
  server = await createServer({ configFile: join(root, 'vite.config.ts'), root, server: { port: 0, open: false, hmr: false } }); await server.listen();
  let page = await open(); report.browser = context.browser().version();
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.waitForFunction(() => window.recorder.phase === 'recording');
  await page.waitForFunction(() => window.recorder.draft?.chunkCount >= 1);
  report.input = await page.evaluate(() => window.testStream.getAudioTracks().map(track => ({ label: track.label, settings: track.getSettings(), readyState: track.readyState, muted: track.muted })));
  if (background) {
    const sample = () => page.evaluate(() => ({ hidden: document.hidden, phase: window.recorder.phase, chunks: window.recorder.draft.chunkCount, coverage: window.recorder.draft.mediaCoverage?.verifiedThroughMs, muted: window.testStream.getAudioTracks()[0].muted }));
    const recordingCdp = await context.newCDPSession(page);
    await recordingCdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const before = await sample();
    const nextPage = context.waitForEvent('page');
    await recordingCdp.send('Target.createTarget', { url: 'about:blank', newWindow: false });
    const other = await nextPage; await other.bringToFront();
    await recordingCdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const otherCdp = await context.newCDPSession(other);
    await otherCdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    report.backgroundWindows = { recording: await recordingCdp.send('Browser.getWindowForTarget'), other: await otherCdp.send('Browser.getWindowForTarget') };
    console.log(JSON.stringify(report.backgroundWindows));
    await page.waitForFunction(() => document.hidden, undefined, { polling: 100 });
    await new Promise(done => setTimeout(done, 20_000));
    const hidden = await sample();
    assert.equal(hidden.hidden, true); assert.equal(hidden.phase, 'recording'); assert.ok(hidden.chunks > before.chunks);
    const windowCdp = await context.newCDPSession(other);
    const { windowId } = await windowCdp.send('Browser.getWindowForTarget');
    await windowCdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    assert.equal((await windowCdp.send('Browser.getWindowBounds', { windowId })).bounds.windowState, 'minimized');
    await new Promise(done => setTimeout(done, 20_000));
    const minimized = await sample();
    assert.equal(minimized.phase, 'recording'); assert.ok(minimized.chunks > hidden.chunks);
    await windowCdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await page.bringToFront(); await other.close();
    report.checks.push({ scenario: 'real tab background and native window minimization preserve input and committed audio', before, hidden, minimized, after: await sample() });
  }
  await context.setOffline(true);
  if (process.env.XOPC_NOTE_BROWSER_ANNOTATIONS === '1') {
    await page.evaluate(async () => window.recorder.mark());
    report.originalMarks = await waitForTimedMarks(page,await page.evaluate(() => window.recorder.draft.id));
  }
  console.log(`Recording offline for ${durationMs} ms with real MediaRecorder`);
  const recordingDeadline = Date.now() + durationMs;
  while (Date.now() < recordingDeadline) {
    await new Promise(done => setTimeout(done, Math.min(30_000, recordingDeadline - Date.now())));
    const progress = await page.evaluate(() => ({ phase: window.recorder.phase, chunks: window.recorder.draft?.chunkCount, savedThroughMs: window.recorder.draft?.mediaCoverage?.verifiedThroughMs, error: window.recorder.error }));
    assert.equal(progress.phase, 'recording', JSON.stringify(progress));
    assert.equal(progress.error, null);
    report.progress ??= []; report.progress.push({ at: new Date().toISOString(), ...progress });
    await mkdir(resolve(reportPath, '..'), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(progress));
  }
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
  await Promise.race([context.close().catch(() => {}), new Promise(done => setTimeout(done, 5_000))]); context = undefined;
  console.log('Killed the browser process; reopening the same on-disk profile');
  page = await open();
  await page.waitForFunction(id => window.recorder.recoverableDrafts.some(draft => draft.id === id), before.id);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.waitForFunction(() => window.recorder.phase === 'stopped');
  const restored = await page.evaluate(id => window.readSavedAudio(id), before.id);
  assert.ok(restored.draft.chunkCount >= before.chunkCount); assert.ok(restored.draft.durationMs >= before.durationMs);
  assert.equal(createHash('sha256').update(Buffer.from(restored.bytes).subarray(0, before.savedBytes)).digest('hex'), before.hash);
  assert.equal(restored.draft.state, 'stopped');
  if (process.env.XOPC_NOTE_BROWSER_ANNOTATIONS === '1') {
    const marks = await page.evaluate(id => window.readSavedMarks(id),before.id);
    assert.deepEqual(marks,report.originalMarks);
    report.checks.push({ scenario: 'offline highlight committed before SIGKILL, stable ID and encoded anchor survive process restart', marks });
  }
  assert.equal(await page.evaluate(() => window.captureStatus.localComplete), false, 'Crash recovery must not claim the uncommitted tail was saved');
  const recoveredPath = join(directory, 'recovered.webm'); await writeFile(recoveredPath, Buffer.from(restored.bytes));
  const decoded = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', recoveredPath], { encoding: 'utf8' }));
  execFileSync(process.env.XOPC_FFMPEG_PATH ?? 'ffmpeg', ['-v', 'error', '-y', '-i', recoveredPath, '-ar', '16000', '-ac', '1', join(directory, 'recovered.wav')]);
  const pcm = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', join(directory, 'recovered.wav')], { encoding: 'utf8' }));
  const decodedDurationMs = Number(pcm.format.duration) * 1000;
  assert.ok(Math.abs(decodedDurationMs - restored.draft.durationMs) < 1_000, 'Decoded duration must match committed metadata');
  if (!physicalMicrophone) assert.equal(restored.draft.mediaCoverage.status, 'verified');
  if (restored.draft.mediaCoverage.status === 'verified') assert.ok(Math.abs(restored.draft.mediaCoverage.verifiedThroughMs - decodedDurationMs) < 2, 'Saved range must come from encoded media time');
  else assert.ok(restored.draft.mediaCoverage.verifiedThroughMs <= decodedDurationMs, 'Unproven gaps must never count as continuous saved audio');
  report.checks.push({ scenario: 'offline capture, SIGKILL, browser restart, IndexedDB restore and audio decode',
    savedChunks: restored.draft.chunkCount, savedDurationMs: restored.draft.durationMs, decodedDurationMs,
    mediaCoverage: restored.draft.mediaCoverage, bytes: restored.bytes.length, prefixHash: before.hash, reportedContainerDuration: decoded.format?.duration });
  if (process.env.XOPC_NOTE_BROWSER_CONTINUATION === '1') {
    await page.evaluate(async () => window.recorder.start({ continuation: window.recorder.draft, onLiveSegment: () => {} }));
    await page.waitForFunction(() => window.recorder.phase === 'recording');
    await page.waitForFunction(count => window.recorder.draft.chunkCount > count, restored.draft.chunkCount);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.waitForFunction(() => window.recorder.phase === 'stopped');
    const resumed = await page.evaluate(async () => ({ draft: window.recorder.draft, epochs: await window.readEpochAudio(window.recorder.draft), archive: await window.readRecoveryPackage(window.recorder.draft) }));
    assert.equal(resumed.draft.id, restored.draft.id); assert.equal(resumed.epochs.length, 2);
    assert.deepEqual(Buffer.from(resumed.epochs[0]), Buffer.from(restored.bytes));
    const epochPaths = [];
    for (let index = 0; index < resumed.epochs.length; index++) {
      const path = join(directory, `epoch-${index}.webm`); epochPaths.push(path);
      await writeFile(path, Buffer.from(resumed.epochs[index]));
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path, join(directory, `epoch-${index}.wav`)]);
    }
    const archivePath = join(directory, 'recovery.tar'); await writeFile(archivePath, Buffer.from(resumed.archive));
    const listing = execFileSync('tar', ['-tf', archivePath], { encoding: 'utf8' });
    assert.ok(listing.includes('manifest.json')); assert.ok(listing.includes('chunks/000000.bin'));
    report.checks.push({ scenario: 'continue after SIGKILL into independent media containers, unchanged source prefix and valid local export archive', draftId: resumed.draft.id, epochs: resumed.draft.epochs, epochPaths, archivePath });
  }
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.waitForFunction(() => window.recorder.phase === 'recording');
  await page.waitForFunction(() => window.recorder.draft?.chunkCount >= 1);
  await page.evaluate(() => window.testStream.getTracks().forEach(track => track.stop()));
  await page.waitForFunction(() => window.recorder.phase === 'stopped');
  const interrupted = await page.evaluate(() => ({ ...window.recorder.draft }));
  assert.ok(interrupted.chunkCount >= 1); assert.equal(interrupted.state, 'stopped');
  assert.equal(interrupted.saveOutcome, 'interrupted');
  assert.equal(await page.evaluate(() => window.captureStatus.localComplete), false);
  report.checks.push({ scenario: 'all microphone tracks stop; MediaRecorder closes and saves tail', chunks: interrupted.chunkCount, durationMs: interrupted.durationMs });
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.waitForFunction(() => window.recorder.phase === 'recording');
  await page.waitForFunction(() => window.recorder.draft?.chunkCount >= 1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForFunction(() => window.recorder.phase === 'paused');
  await new Promise(done => setTimeout(done, 2_000));
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForFunction(() => window.recorder.phase === 'recording');
  if (process.env.XOPC_NOTE_BROWSER_ANNOTATIONS === '1') {
    await page.evaluate(async () => window.recorder.mark());
    report.pausedMarks = await waitForTimedMarks(page,await page.evaluate(() => window.recorder.draft.id));
  }
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.waitForFunction(() => window.recorder.phase === 'stopped');
  assert.equal(await page.evaluate(() => window.captureStatus.localComplete), true);
  const paused = await page.evaluate(() => window.readSavedAudio(window.recorder.draft.id));
  await writeFile(join(directory, 'paused.webm'), Buffer.from(paused.bytes));
  report.checks.push({ scenario: 'pause, resume after real audio input, stop barrier and local success', mediaCoverage: paused.draft.mediaCoverage, saveOutcome: paused.draft.saveOutcome });
  // A page refresh is a separate interruption boundary from a killed browser process.
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.waitForFunction(() => window.recorder.phase === 'recording');
  await page.waitForFunction(() => window.recorder.draft?.chunkCount >= 2);
  const refreshPrefix = await page.evaluate(() => window.readSavedAudio(window.recorder.draft.id));
  await page.evaluate(async () => window.recorder.mark());
  const refreshMarks = await waitForTimedMarks(page, refreshPrefix.draft.id);
  await page.reload();
  await page.waitForFunction(id => window.recorder.recoverableDrafts.some(draft => draft.id === id), refreshPrefix.draft.id);
  await page.evaluate(async id => window.recorder.restore(window.recorder.recoverableDrafts.find(draft => draft.id === id)), refreshPrefix.draft.id);
  await page.waitForFunction(() => window.recorder.phase === 'stopped');
  const refreshed = await page.evaluate(id => window.readSavedAudio(id), refreshPrefix.draft.id);
  assert.deepEqual(Buffer.from(refreshed.bytes).subarray(0, refreshPrefix.bytes.length), Buffer.from(refreshPrefix.bytes));
  const refreshedMarks = await page.evaluate(id => window.readSavedMarks(id), refreshPrefix.draft.id);
  assert.deepEqual(refreshedMarks, refreshMarks);
  assert.equal(refreshed.draft.id, refreshPrefix.draft.id);
  assert.equal(await page.evaluate(() => window.captureStatus.localComplete), false);
  report.checks.push({ scenario: 'page refresh restores the same draft and highlights without changing the committed audio prefix', draftId: refreshed.draft.id, chunks: refreshed.draft.chunkCount, prefixHash: createHash('sha256').update(Buffer.from(refreshPrefix.bytes)).digest('hex'), marks: refreshedMarks });
  if (background) {
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await page.waitForFunction(() => window.recorder.phase === 'recording' && window.recorder.draft.chunkCount >= 1);
    const prefix = await page.evaluate(() => window.readSavedAudio(window.recorder.draft.id));
    const lifecycle = await context.newCDPSession(page);
    await lifecycle.send('Page.setWebLifecycleState', { state: 'frozen' });
    await new Promise(done => setTimeout(done, 3_000));
    await lifecycle.send('Page.setWebLifecycleState', { state: 'active' });
    await page.waitForFunction(id => (window.recorder.phase === 'stopped' && window.recorder.draft?.id === id) || window.recorder.recoverableDrafts.some(draft => draft.id === id && draft.state === 'stopped'), prefix.draft.id);
    await page.evaluate(id => window.recorder.draft?.id === id ? undefined : window.recorder.restore(window.recorder.recoverableDrafts.find(draft => draft.id === id)), prefix.draft.id);
    const recovered = await page.evaluate(id => window.readSavedAudio(id), prefix.draft.id);
    assert.equal(recovered.draft.saveOutcome, 'interrupted');
    assert.deepEqual(Buffer.from(recovered.bytes).subarray(0, prefix.bytes.length), Buffer.from(prefix.bytes));
    await page.evaluate(() => window.recorder.start({ continuation: window.recorder.draft, onLiveSegment: () => {} }));
    await page.waitForFunction(() => window.recorder.phase === 'recording');
    await page.waitForFunction(count => window.recorder.draft.chunkCount > count, recovered.draft.chunkCount);
    await page.evaluate(() => window.recorder.stop());
    assert.equal(await page.evaluate(() => window.recorder.draft.id), prefix.draft.id);
    report.checks.push({ scenario: 'CDP page freeze and thaw (not OS sleep), interrupted source persisted and same draft continued', draftId: prefix.draft.id, savedChunks: recovered.draft.chunkCount });
  }
  assert.deepEqual(errors, []); report.passed = true;
} catch (error) { report.failure = error instanceof Error ? error.stack : String(error); report.pageState = await activePage?.evaluate(() => ({ text: document.body.innerText, phase: window.recorder?.phase, error: window.recorder?.error })).catch(() => null); report.pageErrors = errors;
  if (activePage) { const saved = await activePage.evaluate(() => window.recorder?.draft ? window.readSavedAudio(window.recorder.draft.id) : null).catch(() => null); if (saved) await writeFile(join(directory, 'failure.webm'), Buffer.from(saved.bytes)); }
  process.exitCode = 1; }
finally {
  await context?.close(); ownedBrowser?.kill('SIGTERM'); await server?.close(); await rm(fixture, { recursive: true, force: true });
  await mkdir(resolve(reportPath, '..'), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, reportPath, failure: report.failure }));
}
