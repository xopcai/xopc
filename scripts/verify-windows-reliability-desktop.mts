/** Test-owned visible Electron shell with production DesktopEndpointHost and native Cua. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { DesktopEndpointHost } from '../electron/computer/desktop-host.js';
import { CuaComputerDriver } from '../electron/computer/cua-driver.js';
import { ComputerBroker, type ComputerDriver } from '../src/computer/broker.js';
import { windowsAppIdentity } from '../electron/computer/windows-apps.js';

const timings: Array<{ phase: string; ms: number; ok: boolean }> = [];
function profile(driver: ComputerDriver) {
  for (const phase of ['discover', 'resolveTarget', 'observe', 'perform', 'stop'] as const) {
    const original = driver[phase].bind(driver) as (...args: any[]) => Promise<any>;
    (driver as any)[phase] = async (...args: any[]) => {
      const started = performance.now(); let ok = false;
      try { const value = await original(...args); ok = true; return value; }
      finally { timings.push({ phase, ms: Math.round(performance.now() - started), ok, ...(phase === 'perform' ? { actionKind: args[1]?.kind } : {}) } as any); }
    };
  }
}
async function main() {
  const root = process.env.XOPC_RELIABILITY_ROOT!, fixture = process.env.XOPC_RELIABILITY_FIXTURE!;
  app.setPath('userData', join(root, 'electron')); await app.whenReady();
  const window = new BrowserWindow({ width: 420, height: 180, show: true, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  await window.loadURL('data:text/html,<h2>XOPC Windows reliability validation</h2><p>Disposable native windows only.</p>');
  const host = new DesktopEndpointHost({ connection: () => ({ port: Number(process.env.XOPC_RELIABILITY_PROXY_PORT), token: process.env.XOPC_RELIABILITY_TOKEN! }), window: () => window });
  profile((host.broker as any).driver);
  let nativeInputs = 0;
  const hostDriver = (host.broker as any).driver as ComputerDriver;
  const perform = hostDriver.perform.bind(hostDriver);
  hostDriver.perform = async (...args) => { nativeInputs++; return perform(...args); };
  process.on('message', async (message: any) => {
    try {
      let value: unknown;
      if (message.op === 'status') value = { ...host.snapshot(), nativeInputs, timings };
      else if (message.op === 'access') value = await host.setComputerAppAccess(windowsAppIdentity({ bundleId: fixture, name: 'XopcInputFixture.exe', pid: 0, running: true, active: false })!.appId, true);
      else if (message.op === 'visibility') { message.visible ? window.show() : window.hide(); host.visibilityChanged(); value = true; }
      else if (message.op === 'crashDriver') {
        const client = (hostDriver as any).client; assert.ok(client);
        const metadata = await client.metadata(); assert.ok(metadata.embedded && metadata.hostBundleId === 'com.github.Electron');
        process.kill(metadata.pid); value = true;
      } else if (message.op === 'drain') { await host.broker.stop(); value = true; }
      else if (message.op === 'matrix') { await host.broker.stop(); value = await matrix(root); }
      else if (message.op === 'stop') { await host.close(); window.destroy(); process.send?.({ id: message.id, value: true }, () => app.exit(0)); return; }
      else throw new Error('Unknown private test operation');
      process.send?.({ id: message.id, value });
    } catch (error) { process.send?.({ id: message.id, error: error instanceof Error ? error.message : 'RELIABILITY_DESKTOP_FAILED' }); }
  });
  if (process.env.XOPC_RELIABILITY_MATRIX_ONLY !== 'true') await host.start();
  process.send?.({ ready: true });
}

async function matrix(root: string) {
  const driver = new CuaComputerDriver(process.env.XOPC_RELIABILITY_BINARY!, 'com.github.Electron'); profile(driver);
  const result: any[] = [];
  for (const spec of JSON.parse(await readFile(join(root, 'matrix.json'), 'utf8'))) {
    process.send?.({ progress: { app: spec.name, stage: 'started' } });
    if (spec.skip) { result.push(spec); continue; }
    const wallStart = performance.now(), firstTiming = timings.length;
    const broker = new ComputerBroker(driver, { isVisible: () => true, requestApproval: async request => (request.kind === 'session' ? request.appId : request.target.appId) === spec.appId }, { enabled: true });
    const owner = randomUUID(), sessionId = randomUUID();
    try {
      const apps = await broker.command({ op: 'discover', owner, sessionId, query: spec.query });
      assert.equal(apps.apps?.length, 1, `Ambiguous matrix app: ${spec.name}`);
      await broker.command({ op: 'open', owner, sessionId, appRef: apps.apps![0].appRef, mode: 'control', prepare: spec.prepare,
        model: { modelRef: 'validation/deterministic', profile: 'structured-tools-v1', origin: 'https://validation.invalid', runtimeLocation: 'local' } });
      let state: any; const deadline = Date.now() + 30_000;
      do { state = await broker.command({ op: 'status', owner, sessionId }); if (state.status !== 'pending_authorization') break; assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 50)); } while (true);
      assert.equal(state.status, 'ready', state.errorCode);
      let observed: any;
      const observe = async () => { observed = await broker.command({ op: 'observe', owner, sessionId }); observed.frame?.bytes.fill(0); return JSON.parse(observed.observation.summary).elements; };
      let safeReplans = 0;
      const act = async (action: any, retry = 0): Promise<any> => {
        const previousNodes = JSON.parse(observed.observation.summary).elements;
        const command = { op: 'act' as const, owner, sessionId, envelope: { actionId: randomUUID(), sessionId, observationId: observed.observation.id,
          brokerEpoch: observed.brokerEpoch, generation: observed.generation, grantId: observed.grantId, deadlineAt: Date.now() + 30_000, action } };
        let answer = await broker.command(command);
        while (answer.status === 'pending_action') { await new Promise(r => setTimeout(r, 10)); answer = await broker.command(command); }
        answer.frame?.bytes.fill(0);
        if (answer.errorCode === 'COMPUTER_OBSERVATION_CHANGED' && !answer.receipt && retry < 2) {
          safeReplans++;
          const nodes = await observe();
          if (action.ref) {
            const old = previousNodes.find((e: any) => e.ref === action.ref);
            const matches = nodes.filter((e: any) => e.role === old?.role && e.label === old?.label && (action.kind !== 'setValue' || e.inputAllowed));
            assert.equal(matches.length, 1, 'Fresh semantic target must be unique'); action = { ...action, ref: matches[0].ref };
          } else if (action.kind === 'click') {
            const fields = nodes.filter((e: any) => e.inputAllowed); assert.equal(fields.length, 1);
            const b = fields[0].bounds; action = { ...action, point: { x: b.x + b.width / 2, y: b.y + b.height / 2 } };
          }
          return act(action, retry + 1);
        }
        assert.equal(answer.receipt?.dispatch, 'completed', `${action.kind}: ${answer.errorCode ?? answer.receipt?.errorCode}`);
        const duplicate = await broker.command(command); assert.deepEqual(duplicate.receipt, answer.receipt);
        return answer;
      };
      if (spec.kind === 'calculator') {
        for (const labels of [['清除', 'Clear'], ['六', 'Six'], ['乘以', 'Multiply by'], ['七', 'Seven'], ['等于', 'Equals']]) {
          const nodes = await observe(); const button = nodes.filter((e: any) => e.role === 'AXButton' && labels.includes(e.label)); assert.equal(button.length, 1);
          await act({ kind: 'activate', ref: button[0].ref });
        }
        const nodes = await observe(); assert.ok(nodes.some((e: any) => /^(显示为\s*42|Display is\s*42|42)$/i.test(e.label ?? e.value ?? '')));
        result.push({ name: spec.name, outcome: 'passed', oracle: 'native display equals 42', actions: 5 });
      } else {
        const baseline = spec.oracle ? JSON.parse(await readFile(spec.oracle, 'utf8')).verifyClicks : undefined;
        const trials: any[] = [];
        for (let repetition = 0; repetition < (spec.repetitions ?? 1); repetition++) {
          const trialStart = performance.now();
          let nodes = await observe(); const fields = nodes.filter((e: any) => e.inputAllowed === true); assert.equal(fields.length, 1, 'Need one verified writable field');
          await act({ kind: 'setValue', ref: fields[0].ref, text: 'Windows 输入验证 OK' });
          nodes = await observe(); const field = nodes.find((e: any) => e.ref === fields[0].ref);
          if (!field?.keyboardFocused) { const b = field.bounds; await act({ kind: 'click', point: { x: b.x + b.width / 2, y: b.y + b.height / 2 }, button: 'left', count: 1 }); await observe(); }
          await act({ kind: 'pressKeys', keys: ['end'] });
          nodes = await observe();
          if (spec.oracle) {
            const button = nodes.filter((e: any) => e.label === 'Verify' && e.role === 'AXButton'); assert.equal(button.length, 1);
            await act({ kind: 'activate', ref: button[0].ref });
            await new Promise(r => setTimeout(r, 300));
            const oracle = JSON.parse(await readFile(spec.oracle, 'utf8'));
            assert.equal(oracle.validated, true); assert.equal(oracle.verifyClicks, baseline + repetition + 1); assert.equal(oracle.protectedLength, 0); assert.equal(oracle.readOnlyText, 'READ ONLY');
          } else {
            // Notepad's pinned native backend may refuse background accelerators.
            // Grade the refusal as a limitation, never as a successful file save.
            const before = await readFile(spec.document, 'utf8');
            try { await act({ kind: 'pressKeys', keys: ['ctrl', 's'] }); }
            catch (error) {
              if (!(error instanceof Error) || !error.message.includes('COMPUTER_DRIVER_HOTKEY_REFUSED')) throw error;
              assert.equal(broker.snapshot().status, 'stopped');
              assert.equal(await readFile(spec.document, 'utf8'), before);
              result.push({ name: spec.name, outcome: 'limited', reason: 'COMPUTER_DRIVER_HOTKEY_REFUSED',
                textAndEndDispatchCompleted: true, saveVerified: false, stoppedWithoutReplay: true, safeReplans });
              break;
            }
            const deadline = Date.now() + 5000;
            while ((await readFile(spec.document, 'utf8')).replace(/^\uFEFF/, '') !== 'Windows 输入验证 OK') { assert.ok(Date.now() < deadline, 'Notepad save oracle failed'); await new Promise(r => setTimeout(r, 100)); }
          }
          trials.push({ repetition, wallMs: Math.round(performance.now() - trialStart), verified: true });
        }
        if (result.at(-1)?.name !== spec.name) result.push({ name: spec.name, outcome: 'passed', oracle: spec.oracle ? 'app-owned control/event state' : 'saved disposable document', trials, safeReplans });
      }
    } catch (error) { result.push({ name: spec.name, outcome: 'failed', reason: error instanceof Error ? error.message : 'MATRIX_FAILED' }); }
    finally { await broker.dispose(); }
    const last = result.at(-1); last.wallMs = Math.round(performance.now() - wallStart); last.timings = timings.slice(firstTiming);
    await writeFile(join(root, 'matrix-progress.json'), JSON.stringify(result, null, 2));
    process.send?.({ progress: { app: spec.name, stage: last.outcome, reason: last.reason, wallMs: last.wallMs } });
  }
  await writeFile(join(root, 'matrix-result.json'), JSON.stringify(result, null, 2));
  return result;
}
void main().catch(error => { console.error(error.message); app.exit(1); });
