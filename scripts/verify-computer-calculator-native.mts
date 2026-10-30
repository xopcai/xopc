/** Opt-in real Calculator acceptance; no input is retried after submission. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { CuaComputerDriver } from '../electron/computer/cua-driver.js';
import { resolveLocalComputerDriver } from '../electron/computer/local-driver.js';
import { withWindowReadiness } from '../electron/computer/window-readiness.js';

async function main() {
  const [repo, output] = process.argv.slice(2);
  await app.whenReady();
  const controlHost = new BrowserWindow({ width: 460, height: 180, show: false, title: 'xopc computer-use acceptance' });
  await controlHost.loadURL('data:text/html,<meta charset="utf-8"><title>xopc computer-use acceptance</title><p>Local computer-use acceptance host. This temporary window closes when validation finishes.</p>');
  const manifest = JSON.parse(await readFile(join(repo, '.cache/computer-driver/local/current.json'), 'utf8'));
  let binary = resolveLocalComputerDriver(repo, process.platform, process.arch);
  const selected = process.env.XOPC_CALCULATOR_DRIVER_SHA;
  if (selected) {
    assert.match(selected, /^[a-f0-9]{64}$/);
    binary = join(repo, '.cache/computer-driver/local', selected, 'cua-driver');
    assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'), selected);
    manifest.binary = `${selected}/cua-driver`; manifest.sha256 = selected;
  }
  const driver = new CuaComputerDriver(binary, 'com.github.Electron');
  const signal = AbortSignal.timeout(90_000);
  const report: any = { createdAt: new Date().toISOString(), manifest, scope: 'real Calculator via production CuaComputerDriver; no model, gateway, approval UI or upload', runs: [] };
  const scenario = process.env.XOPC_CALCULATOR_SCENARIO ?? 'warm';
  assert.ok(['warm', 'cold', 'cross-space'].includes(scenario));
  report.scenario = scenario;
  const resident = process.env.XOPC_CALCULATOR_DRIVER_LIFECYCLE === 'resident';
  report.driverLifecycle = resident ? 'resident' : 'fresh';
  const calls: any[] = [];
  let stage = 'driverStartup';
  let coldStart = performance.now();
  try {
    if (scenario !== 'warm') {
      const fixtureStart = performance.now();
      await (driver as any).start();
      const fixtureClient = (driver as any).client;
      (driver as any).client = new Proxy(fixtureClient, { get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== 'function') return value;
        return async (...args: any[]) => {
          try {
            const result = await value.apply(target, args);
            if (key === 'callTool' && args[0] === 'list_apps' && String(args[1]).includes('process_identity_pid') && result.isError) {
              report.fixtureIdentityRefusal = { text: result.text, structuredJson: result.structuredJson, rawJson: result.rawJson };
            }
            return result;
          } catch (error) {
            if (key === 'callTool' && args[0] === 'list_apps' && String(args[1]).includes('process_identity_pid')) report.fixtureIdentityRefusal = String(error);
            throw error;
          }
        };
      } });
      assert.equal((driver as any).foregroundAppPreparation, true);
      controlHost.show(); controlHost.focus();
      const target = await driver.resolveTarget('com.apple.calculator', signal, { prepare: true });
      if (scenario === 'cold') {
        await (driver as any).prepareApplication('com.apple.calculator', signal);
        const quit = await (driver as any).client.callTool('hotkey', JSON.stringify({ pid: target.pid, window_id: Number(target.windowId),
          keys: ['cmd', 'q'], delivery_mode: 'foreground' }), { signal });
        if (quit.isError) { report.fixtureRefusal = { text: quit.text, structuredJson: quit.structuredJson, rawJson: quit.rawJson }; throw new Error('Fixture quit refused'); }
        await withWindowReadiness(signal, (_readySignal, poll) => poll(async () => {
          const apps = await (driver as any).listApps(signal, undefined, true);
          return apps.some((item: any) => item.bundleId === 'com.apple.calculator' && item.pid > 0) ? undefined : true;
        }));
        report.fixture = { appNotRunningVerified: true, exitedPid: target.pid };
      } else {
        const entered = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Fixture fullscreen transition timed out')), 5000);
          controlHost.once('enter-full-screen', () => { clearTimeout(timer); resolve(); });
        });
        controlHost.setFullScreen(true);
        await entered;
        await withWindowReadiness(signal, (_readySignal, poll) => poll(async () => {
          const windows = await (driver as any).listWindows(target.pid, signal);
          const window = windows.find((item: any) => String(item.windowId) === target.windowId);
          return window?.onCurrentSpace === false ? true : undefined;
        }));
        report.fixture = { otherSpaceVerified: true, pid: target.pid, processIdentity: target.processIdentity, windowId: target.windowId,
          source: 'temporary test host fullscreen Space; no other user application activated' };
      }
      if (resident) await driver.idle(); else await driver.stop();
      report.fixtureSetupMs = performance.now() - fixtureStart;
      coldStart = performance.now();
    }
    if (scenario === 'warm') controlHost.show();
    await driver.warmup();
    report.driverStartupMs = performance.now() - coldStart;
    assert.equal((driver as any).exactNativeBatch, true, 'Candidate exact-batch capability missing');
    const client = (driver as any).client;
    (driver as any).client = new Proxy(client, { get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      return async (...args: any[]) => {
        const started = performance.now();
        const call: any = { stage, method: String(key), ...(key === 'callTool' ? { tool: args[0] } : {}) };
        try {
          if (key === 'callTool' && args[0] === 'list_windows') {
            const flags = JSON.parse(args[1]);
            call.operation = flags.readiness_end ? 'observerEnd' : flags.readiness_wait_ms ? 'observerWait' : 'windowMetadata';
            call.identityBound = flags.include_process_identity === true;
          }
          const result = await value.apply(target, args);
          if (key === 'callTool' && result.isError) call.refusal = { text: result.text, structuredJson: result.structuredJson, rawJson: result.rawJson, args: args[1] };
          if (key === 'callTool' && ['run_steps', 'bring_to_front', 'launch_app'].includes(args[0])) call.result = JSON.parse(result.structuredJson ?? result.rawJson ?? '{}');
          if (key === 'listWindows') call.windows = result.windows.map((window: any) => ({ windowId: String(window.windowId),
            onCurrentSpace: window.onCurrentSpace, isOnScreen: window.isOnScreen, bounds: window.bounds, layer: window.layer }));
          return result;
        } finally { call.ms = performance.now() - started; calls.push(call); }
      };
    } });
    if (process.env.XOPC_CALCULATOR_ACTIVATE === '1') {
      stage = 'explicitAppActivation';
      const started = performance.now();
      const apps = await (driver as any).listApps(signal, undefined, true);
      const matches = apps.filter((item: any) => item.bundleId === 'com.apple.calculator' && item.pid > 0);
      assert.equal(matches.length, 1);
      report.initialAppState = 'already running; explicit activation required after prior other-space refusal';
      await (driver as any).callUntyped('bring_to_front', { pid: matches[0].pid }, signal);
      await withWindowReadiness(signal, async (readySignal, poll) => poll(async () => {
        try { return await driver.resolveTarget('com.apple.calculator', readySignal, { prepare: false }); }
        catch (error) {
          if (error instanceof Error && ['COMPUTER_WINDOW_OTHER_SPACE', 'COMPUTER_WINDOW_HIDDEN', 'COMPUTER_WINDOW_REQUIRED'].includes(error.message)) return undefined;
          throw error;
        }
      }));
      report.explicitAppActivationMs = performance.now() - started;
    }
    const samples = Number(process.env.XOPC_CALCULATOR_SAMPLES ?? 3);
    assert.ok(Number.isInteger(samples) && samples > 0 && samples <= 5);
    assert.ok(scenario === 'warm' || samples === 1, 'Each cold/cross-Space sample requires its own fixture setup');
    for (let sample = 0; sample < samples; sample++) {
      const row: any = { sample, stages: {} }; report.runs.push(row);
      const started = performance.now();
      const timed = async <T>(name: string, work: () => Promise<T>) => {
        stage = name; const start = performance.now();
        try { return await work(); } finally { row.stages[name] = performance.now() - start; }
      };
      const target = await timed('openAndResolve', () => driver.resolveTarget('com.apple.calculator', signal, { prepare: true }));
      row.target = { pid: target.pid, windowId: target.windowId, processIdentity: target.processIdentity };
      if (scenario === 'cold') assert.notEqual(target.pid, report.fixture.exitedPid);
      if (scenario === 'cross-space') {
        assert.equal(target.pid, report.fixture.pid);
        assert.equal(target.processIdentity, report.fixture.processIdentity);
        assert.equal(target.windowId, report.fixture.windowId);
      }
      const before = await timed('initialObservation', () => driver.observe(target, signal));
      row.preparationTiming = driver.getLastPreparationTiming();
      const tree = JSON.parse(before.summary);
      await writeFile(join(output, `before-${sample}.json`), JSON.stringify(tree, null, 2));
      before.image.fill(0);
      const buttons = tree.elements.filter((e: any) => e.role === 'AXButton' && e.semanticActions?.includes('activate'));
      const find = (labels: string[]) => {
        const found = buttons.filter((e: any) => labels.includes(String(e.label).trim()));
        assert.equal(found.length, 1, `Expected unique button ${labels.join('/')}; observed: ${buttons.map((e: any) => e.label).join(', ')}`);
        return { kind: 'activate' as const, ref: found[0].ref };
      };
      const actions = [
        find(['All Clear', 'Clear', '全部清除', '清除', 'AC', 'C']),
        find(['1']), find(['2']), find(['3']), find(['+', '加', '加号', 'Add']),
        find(['3']), find(['4']), find(['5']), find(['=', '等于', 'Equals']),
      ];
      row.progress = [];
      const callStart = calls.length;
      await timed('nativeBatch', () => driver.perform(before.target, { kind: 'batch', actions }, signal,
        (index, dispatch) => row.progress.push({ index, dispatch })));
      row.inputTiming = driver.getLastInputTiming();
      row.batchCalls = calls.slice(callStart);
      row.nativeInputCalls = row.batchCalls.filter((call: any) => call.tool === 'run_steps');
      row.nativeIdentityCalls = row.batchCalls.filter((call: any) => call.tool === 'list_apps');
      assert.equal(row.nativeInputCalls.length, 1, 'Expected exactly one native input RPC');
      assert.ok(row.nativeIdentityCalls.length <= 1, 'Unexpected repeated native identity proof');
      assert.equal(row.batchCalls.length, row.nativeInputCalls.length + row.nativeIdentityCalls.length, 'Unexpected native call inside batch');
      const after = await timed('finalObservation', () => driver.observe(before.target, signal));
      const resultTree = JSON.parse(after.summary);
      await writeFile(join(output, `after-${sample}.json`), JSON.stringify(resultTree, null, 2));
      await writeFile(join(output, `result-${sample}.png`), after.image);
      after.image.fill(0);
      row.resultElements = resultTree.elements.filter((e: any) => [e.label, e.value, e.value_description].some(v => typeof v === 'string' && /468/.test(v)));
      row.verified = row.resultElements.length > 0 || /468/.test(resultTree.text);
      row.totalMs = performance.now() - started;
      row.executionMs = row.stages.openAndResolve + row.stages.initialObservation + row.stages.nativeBatch + row.stages.finalObservation;
      row.gapToOneSecondMs = row.executionMs - 1000;
      assert.ok(row.verified, 'Final independent observation did not expose 468');
      row.result = 468;
      console.log(JSON.stringify({ sample, ...row.stages, executionMs: row.executionMs, result: row.result }));
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error);
    console.error(report.error); process.exitCode = 1;
  } finally {
    report.calls = calls; report.captureStats = driver.getCaptureStats();
    report.driverStartupPlusExecutionMs = report.runs[0]?.executionMs == null ? null : report.driverStartupMs + report.runs[0].executionMs;
    report.firstFlowIncludingActivationMs = report.driverStartupPlusExecutionMs == null ? null
      : report.driverStartupPlusExecutionMs + (report.explicitAppActivationMs ?? 0);
    await driver.stop();
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    app.exit(Number(process.exitCode ?? 0));
  }
}
void main().catch(error => { console.error(error); app.exit(1); });
