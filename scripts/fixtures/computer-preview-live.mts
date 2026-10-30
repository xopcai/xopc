import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { app, BrowserWindow } from 'electron';
import { ComputerPreviewManager } from '../../electron/computer/preview-manager.js';
import { startPreviewCapture } from '../../electron/computer/preview-capture.js';
import { CuaComputerDriver } from '../../electron/computer/cua-driver.js';
import { resolveLocalComputerDriver } from '../../electron/computer/local-driver.js';
import type { ComputerPreviewAuthority } from '../../src/computer/broker.js';
import { registerComputerPreviewIpc } from '../../electron/computer/preview-ipc.js';

async function main() {
  app.on('window-all-closed', () => {});
  await app.whenReady();
  const [repo, root] = process.argv.slice(2);
  let binary = resolveLocalComputerDriver(repo, process.platform, process.arch);
  const manifest = JSON.parse(await readFile(join(repo, '.cache/computer-driver/local/current.json'), 'utf8'));
  const selected = process.env.XOPC_PREVIEW_DRIVER_SHA;
  if (selected) {
    assert.match(selected, /^[a-f0-9]{64}$/); binary = join(repo, '.cache/computer-driver/local', selected, 'cua-driver');
    assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'), selected);
    manifest.binary = `${selected}/cua-driver`; manifest.sha256 = selected;
  }
  const driver = new CuaComputerDriver(binary, 'com.github.Electron');
  const signal = AbortSignal.timeout(90_000);
  const report: any = { createdAt: new Date().toISOString(), samples: [], fixtureOnly: true,
    driver: manifest };
  let manager: ComputerPreviewManager | undefined;
  let viewer: BrowserWindow | undefined;
  try {
    const target = await driver.resolveTarget('ai.xopc.preview-benchmark', signal, { prepare: false });
    let unavailable!: (reason: Error) => void;
    const failure = new Promise<never>((_resolve, reject) => { unavailable = reject; });
    let id: string;
    let binding: ComputerPreviewAuthority | undefined = { conversationId: 'preview-acceptance', runId: 'run', computerSessionId: 'session',
      brokerEpoch: 'benchmark', appName: 'XopcPreviewBenchmark', status: 'ready', target, signal };
    manager = new ComputerPreviewManager({ authority: () => binding,
      validate: async authority => driver.validatePreviewTarget(authority.target!, authority.signal),
      capture: (authority, preset, frame, failed) => startPreviewCapture(authority, preset, frame, failed,
        () => driver.validatePreviewTarget(authority.target!, authority.signal)),
      changed: state => {
        if (state.status === 'unavailable') unavailable(new Error(state.errorCode));
        viewer?.webContents.send('computer-preview:state', state);
      },
    });
    viewer = new BrowserWindow({ show: false, focusable: false, webPreferences: {
      preload: join(root, 'preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    } });
    registerComputerPreviewIpc(() => ({ preview: manager!, stopPreviewControl: async () => { binding = undefined; manager!.sync(); await driver.stop(); } }) as any,
      event => { assert.equal(event.sender, viewer!.webContents); assert.equal(event.senderFrame, viewer!.webContents.mainFrame); });
    await viewer.loadFile(join(root, 'viewer.html'));
    const sample = async (preview: boolean) => {
      const before = await driver.observe(target, signal); before.image.fill(0);
      const tree = JSON.parse(before.summary);
      const button = tree.elements.find((item: any) => item.label === 'Increment' && item.semanticActions.includes('activate'));
      assert.ok(button);
      const started = performance.now();
      await driver.perform(before.target, { kind: 'activateSequence', refs: Array(5).fill(button.ref) }, signal);
      report.samples.push({ preview, ms: performance.now() - started, detail: driver.getLastInputTiming() });
    };
    await sample(false);
    const started = performance.now();
    const subscription = await viewer.webContents.executeJavaScript(`(async () => {
      window.previewFrames = []; window.previewStarted = performance.now();
      return await window.electronAPI.computer.preview.subscribe({conversationId:'preview-acceptance',runId:'run',preset:'compact'}, async frame => {
        if (!('sequence' in frame)) return;
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(frame.bytes)], {type:'image/jpeg'}));
        const canvas = document.getElementById('preview'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap,0,0); bitmap.close();
        window.previewFrames.push({at:performance.now()-window.previewStarted,width:frame.width,height:frame.height});
      });
    })()`);
    id = subscription.subscriptionId;
    const waitFrames = async (count: number) => {
      const began = performance.now();
      while (await viewer!.webContents.executeJavaScript('window.previewFrames.length') < count) {
        assert.ok(performance.now() - began < 12_000, `Only ${await viewer!.webContents.executeJavaScript('window.previewFrames.length')} frames arrived`);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };
    await Promise.race([waitFrames(1), failure]);
    report.firstFrameMs = performance.now() - started;
    await sample(true); await sample(true);
    manager.setPreset(id, 'expanded');
    await sample(true);
    await Promise.race([waitFrames(5), failure]);
    const presented = await viewer.webContents.executeJavaScript('window.previewFrames');
    await writeFile(join(root, 'viewer.png'), (await viewer.webContents.capturePage()).toPNG());
    manager.setPreset(id, 'paused');
    const pausedFrames = presented.length;
    await sample(false);
    assert.equal(await viewer.webContents.executeJavaScript('window.previewFrames.length'), pausedFrames, 'Paused capture kept sending frames');
    manager.unsubscribe(id);
    const independent = await driver.observe(target, signal); independent.image.fill(0);
    assert.match(JSON.parse(independent.summary).text, /Input count 25/);
    report.frames = presented; report.captureStats = driver.getCaptureStats();
    binding = undefined; manager.sync();
    assert.equal(manager.current('preview-acceptance')?.status, 'ended');
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
  finally { manager?.dispose(); viewer?.destroy(); await driver.stop(); await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2)); app.exit(Number(process.exitCode ?? 0)); }
}
void main().catch(error => { console.error(error); app.exit(1); });
