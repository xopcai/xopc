/** Dedicated-AVD verification for cached UI helpers, Unicode channel reuse and batched readings. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { AdbPhoneDriver, resolveAdbPath, runAdb } from '../src/phone/adb-driver.js';
import { CloudAdbConnection } from '../src/phone/cloud-adb-connection.js';
import { openLocalPhoneUi } from '../src/phone/ui-session.js';
import { PHONE_UI_DEX } from '../src/phone/ui-dump-binary.js';
import { readScrcpyServer, scrcpyServerPath } from '../src/phone/scrcpy-assets.js';
import { PhoneExecutionTrace } from '../src/phone/execution-trace.js';
import { loadBaseline } from './phone-apps-live/support.js';

const option = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const output = process.argv.includes('--output') ? resolve(option('--output')) : undefined;
const baseline = process.argv.includes('--baseline-dir') ? resolve(option('--baseline-dir')) : undefined;
assert(output && baseline, 'Pass --baseline-dir and a fresh --output JSON path');
assert(!existsSync(output), 'Existing evidence is never overwritten');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serial = 'emulator-5554'; const adb = resolveAdbPath();
const signal = AbortSignal.timeout(300000);
const shell = async (...args: string[]) => (await runAdb(adb, ['-s', serial, 'shell', ...args], signal)).toString();
assert.equal((await shell('getprop', 'ro.boot.qemu.avd_name')).trim(), 'XOPC_Android_Test_API_35');
const scrcpyBinary = await readScrcpyServer();
const state = await mkdtemp(join(tmpdir(), 'phone-efficiency-verification-'));
const modules = await mkdtemp(join(root, '.phone-efficiency-check-'));
Object.assign(process.env, { XOPC_STATE_DIR: state, XOPC_MODELS_JSON: join(state, 'models.json'),
  XOPC_CONFIG_PATH: join(state, 'xopc.json'), XOPC_CONFIG: join(state, 'xopc.json'),
  XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false' });
await mkdir(dirname(scrcpyServerPath()), { recursive: true });
await writeFile(scrcpyServerPath(), scrcpyBinary);
await writeFile(join(state, 'xopc.json'), '{}');
await writeFile(join(state, 'models.json'), JSON.stringify({ providers: { 'phone-efficiency-check': {
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', apiKey: 'ZHIPU_API_KEY',
  models: [{ id: 'autoglm-phone', input: ['text', 'image'], maxTokens: 3000, phoneUse: { profile: 'autoglm-phone-v1' } }],
} } }));
const legacy = await loadBaseline(root, baseline, modules);
const results: Record<string, unknown> = {
  device: 'XOPC_Android_Test_API_35', testedAt: new Date().toISOString(),
  limitations: ['Cloud helper commands are bridged through local ADB; these are not cloud-network latency measurements.',
    'Three samples per helper strategy and four Unicode/special-character replacements per implementation are mechanism checks, not production P95 estimates.'],
};
const binary = Buffer.from(PHONE_UI_DEX, 'base64');
const cacheRemote = `/data/local/tmp/xopc-ui-${createHash('sha256').update(binary).digest('hex')}.dex`;
let uploads = 0;
const connection = new CloudAdbConnection('local-test:5555', Buffer.from('unused-local-bridge'));
// Exercise the actual cloud helper deployment logic against the dedicated emulator.
connection.command = async (_path, args, requestedSignal) => {
  try { return await runAdb(adb, ['-s', serial, ...args.slice(2)], requestedSignal); }
  catch (error) {
    // Direct cloud shell sockets return command output rather than rejecting on a remote missing file.
    if (args.includes('sha256sum') && !requestedSignal?.aborted) return Buffer.alloc(0);
    throw error;
  }
};
connection.client = async () => ({
  createSocket: async (command: string) => {
    assert(/^exec:env CLASSPATH=\/data\/local\/tmp\/xopc-ui-[0-9a-f]{64}\.dex app_process \/ ai\.xopc\.phone\.PhoneUiDump --resident$/.test(command));
    const child = spawn(adb, ['-s', serial, 'shell', '-T', ...command.slice(5).split(' ')], { stdio: ['pipe', 'pipe', 'ignore'] });
    child.on('error', () => {}); child.stdin.on('error', () => {});
    return { readable: child.stdout, writable: new WritableStream<Uint8Array>({
      write: data => new Promise<void>((resolve, reject) => child.stdin.write(data, error => error ? reject(error) : resolve())),
    }), close: async () => {
      child.stdin.destroy(); child.stdout.destroy();
      if (child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => { child.once('close', resolve); child.kill(); });
    } };
  }, sync: async () => ({
  write: async ({ filename, permission, file }: any) => {
    const chunks = []; const reader = file.getReader();
    for (;;) { const next = await reader.read(); if (next.done) break; chunks.push(Buffer.from(next.value)); }
    const path = join(state, `${randomUUID()}.dex`); await writeFile(path, Buffer.concat(chunks));
    await runAdb(adb, ['-s', serial, 'push', path, filename], signal);
    await shell('chmod', permission.toString(8), filename); uploads++;
  }, dispose: async () => {},
}) }) as never;
try {
  if (!process.argv.includes('--fields-only')) {
  // UiAutomation has one owner. Stop only the CLI fixture on this dedicated AVD before testing the helper.
  await shell('am', 'force-stop', 'com.android.cli.interact.instrumentation');
  results.helperFixture = 'Android CLI instrumentation stopped on the dedicated test AVD before one-shot helper checks';
  const helpers = []; results.helpers = helpers;
  await shell('rm', '-f', cacheRemote);
  for (let repeat = 0; repeat < 3; repeat++) for (const arm of (repeat % 2 ? ['cached', 'one-shot'] : ['one-shot', 'cached'])) {
    const started = performance.now(); const before = uploads;
    let xml: string;
    if (arm === 'cached') xml = await connection.hierarchy(signal);
    else {
      const remote = `/data/local/tmp/xopc-efficiency-${randomUUID()}.dex`;
      const path = join(state, 'legacy.dex'); await writeFile(path, binary);
      await runAdb(adb, ['-s', serial, 'push', path, remote], signal); uploads++;
      await shell('chmod', '600', remote);
      try { xml = await shell('env', `CLASSPATH=${remote}`, 'app_process', '/', 'ai.xopc.phone.PhoneUiDump'); }
      finally { await shell('rm', '-f', remote); }
    }
    assert(xml.includes('<hierarchy') && xml.includes('</hierarchy>'));
    helpers.push({ arm, repeat: repeat + 1, durationMs: Math.round(performance.now() - started), uploads: uploads - before });
  }
  results.helpers = helpers;
  const cloudDriver = new AdbPhoneDriver('', connection.command.bind(connection), false, undefined, undefined, connection.hierarchy.bind(connection));
  const cloudTrace = new PhoneExecutionTrace();
  const cloudScreen = await cloudTrace.run(() => cloudDriver.observe(connection.endpoint, signal));
  try {
    assert(cloudScreen.elements.length > 0 && cloudScreen.width > 0 && cloudScreen.height > 0);
    results.cloudDriverObservation = { nativeNodes: cloudScreen.elements.length, width: cloudScreen.width, height: cloudScreen.height,
      validPackageAssociation: true, performance: cloudTrace.snapshot() };
  } finally { cloudScreen.frame.fill(0); cloudTrace.finish(); }
  const lifecycleObserver = await openLocalPhoneUi(adb, serial, signal);
  try {
    assert((await lifecycleObserver.snapshot(signal)).includes('</hierarchy>'));
    const cancel = new AbortController();
    const begin = performance.now();
    const pending = lifecycleObserver.snapshot(cancel.signal);
    setTimeout(() => cancel.abort(), 5);
    await assert.rejects(pending, { code: 'PHONE_UI_UNAVAILABLE' });
    await lifecycleObserver.close();
    let exited = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const processes = await shell('ps', '-A', '-o', 'ARGS');
      if (!processes.includes('ai.xopc.phone.PhoneUiDump')) { exited = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(exited, 'The cancelled resident helper must exit and release accessibility ownership');
    results.observerCancellation = { rejectedPendingRead: true, remoteProcessExited: true, durationMs: Math.round(performance.now() - begin) };
  } finally { await lifecycleObserver.close(); }
  if (!process.argv.includes('--helpers-only')) {
  const unicode = []; results.unicode = unicode;
  for (const arm of (process.argv.includes('--reverse-input-order') ? ['efficiency', 'baseline'] : ['baseline', 'efficiency'])) {
    await shell('am', 'force-stop', 'com.android.cli.interact.instrumentation');
    const driver = arm === 'baseline' ? new legacy.driver.AdbPhoneDriver(adb) : new AdbPhoneDriver(adb);
    await shell('am', 'force-stop', 'com.google.android.settings.intelligence');
    await shell('am', 'force-stop', 'com.android.settings');
    await shell('am', 'start', '-W', '-f', '0x10008000', '-a', 'android.settings.SETTINGS');
    let observation: Awaited<ReturnType<AdbPhoneDriver['observe']>>;
    let target: Awaited<ReturnType<AdbPhoneDriver['observe']>>['elements'][number];
    for (let attempt = 0; attempt < 3; attempt++) {
      observation = await driver.observe(serial, signal);
      target = observation.elements.find(node => /search settings|search|搜索设置|搜索/i.test(`${node.text} ${node.description}`)
        && node.bounds[2] > node.bounds[0] && node.bounds[3] > node.bounds[1]);
      if (target && observation.package === 'com.android.settings') break;
      target = undefined; observation.frame.fill(0);
    }
    assert(target, 'Settings search control must be visible');
    await driver.execute(serial, { type: 'tap', point: [500 * (target.bounds[0] + target.bounds[2]) / observation.width,
      500 * (target.bounds[1] + target.bounds[3]) / observation.height] }, observation, signal);
    observation.frame.fill(0);
    const trace = new PhoneExecutionTrace();
    const started = performance.now();
    const samples = [];
    try {
      await trace.run(async () => {
        for (const text of ['咖啡', '地图', '咖啡😀', 'A&B <C> \"D\" &lt; 😀']) {
          observation = await driver.observe(serial, signal);
          try {
            const begin = performance.now();
            await driver.execute(serial, { type: 'typeText', mode: 'replace', text }, observation, signal, { settleMs: 0 });
            samples.push({ text, durationMs: Math.round(performance.now() - begin) });
          } finally { observation.frame.fill(0); }
          const confirmed = await driver.observe(serial, signal);
          try { assert(confirmed.elements.some(node => node.editable && node.text === text), 'Independent exact field verification failed'); }
          finally { confirmed.frame.fill(0); }
        }
      });
    } finally { await driver.releaseInput?.(); trace.finish(); }
    unicode.push({ arm, durationMs: Math.round(performance.now() - started), samples, performance: trace.snapshot() });
  }
  results.unicode = unicode;
  await shell('am', 'force-stop', 'com.android.cli.interact.instrumentation');
  const resident = new AdbPhoneDriver('', connection.command.bind(connection), false, undefined, undefined, undefined, undefined,
    requestedSignal => connection.observer(requestedSignal));
  const residentTrace = new PhoneExecutionTrace();
  try {
    const timings = [];
    await residentTrace.run(async () => {
      for (let index = 0; index < 6; index++) {
        const begin = performance.now(); const screen = await resident.observe(connection.endpoint, signal);
        timings.push(Math.round(performance.now() - begin)); screen.frame.fill(0);
      }
      const screen = await resident.observe(connection.endpoint, signal);
      try { await resident.execute(connection.endpoint, { type: 'typeText', mode: 'replace', text: '云端验证😀' }, screen, signal, { settleMs: 0 }); }
      finally { screen.frame.fill(0); }
      const verified = await resident.observe(connection.endpoint, signal);
      try {
        const editor = verified.elements.find(node => node.focused && node.editable && !node.password);
        assert(editor); assert.equal(editor.text, '云端验证😀');
        const stale = { ...verified, elements: [{ ...editor, text: 'incorrect old value' }] };
        await assert.rejects(resident.execute(connection.endpoint, { type: 'typeText', mode: 'replace', text: 'must not appear' }, stale, signal, { settleMs: 0 }),
          { code: 'PHONE_TEXT_INPUT_UNCONFIRMED' });
      } finally { verified.frame.fill(0); }
    });
    await resident.releaseInput();
    const unchanged = await resident.observe(connection.endpoint, signal);
    try { assert(unchanged.elements.some(node => node.editable && node.text === '云端验证😀')); }
    finally { unchanged.frame.fill(0); }
    results.residentCloudBridge = { coldAndWarmObservationMs: timings, unicodeVerified: true, staleValueRefusedWithoutWrite: true,
      performance: residentTrace.snapshot() };
  } finally { await resident.releaseInput(); residentTrace.finish(); }
  // Preserve the separate, optional batched-reading experiment's expected scratch query.
  const restore = new AdbPhoneDriver(adb);
  try {
    const screen = await restore.observe(serial, signal);
    try { await restore.execute(serial, { type: 'typeText', mode: 'replace', text: '咖啡😀' }, screen, signal, { settleMs: 0 }); }
    finally { screen.frame.fill(0); }
  } finally { await restore.releaseInput(); }
  }
  }
  if (process.env.XOPC_PHONE_REAL_MODEL === '1' && !process.argv.includes('--helpers-only')) {
    assert(process.env.ZHIPU_API_KEY, 'ZHIPU_API_KEY is required for the one-request reading check');
    const { createPhoneModel, parseAutoGlmResponse } = await import('../src/phone/model-adapter.js');
    const { ConfigSchema } = await import('../src/config/schema.js');
    if (process.argv.includes('--field-diagnostics')) {
      const nativeFetch = globalThis.fetch;
      globalThis.fetch = async (...args) => {
        const response = await nativeFetch(...args);
        const payload = await response.clone().json() as any;
        const raw = payload.choices?.[0]?.message?.content;
        if (typeof raw === 'string') {
          try {
            const decision = parseAutoGlmResponse(raw, [], { appAccess: 'all' });
            if (decision.kind === 'complete') {
              const summary = decision.summary;
              let json = false; let escapedJson = false;
              try { JSON.parse(summary); json = true; } catch { /* Classification only. */ }
              try { JSON.parse(JSON.parse(`"${summary}"`)); escapedJson = true; } catch { /* Classification only. */ }
              results.fieldFormat = { decision: decision.kind, summaryChars: summary.length, json, escapedJson,
                startsWithObject: summary.trim().startsWith('{'), startsWithFence: summary.trim().startsWith('```') };
            } else results.fieldFormat = { decision: decision.kind };
          } catch { results.fieldFormat = { decision: 'invalid' }; }
        }
        return response;
      };
    }
    const adapter = await createPhoneModel('phone-efficiency-check/autoglm-phone', ConfigSchema.parse({}), 'main');
    const readingDriver = new AdbPhoneDriver(adb);
    const observation = await readingDriver.observe(serial, signal);
    const trace = new PhoneExecutionTrace();
    try {
      assert(observation.elements.some(node => node.editable && node.text === '咖啡😀'), 'Prepare the expected scratch query before reading fields');
      const values = await trace.run(() => adapter.readFields!({ goal: 'Read the visible search query and page title', observation,
        allowedApps: ['com.google.android.settings.intelligence'], history: [] },
      [{ key: 'query', description: 'Exact current search query including any emoji' }, { key: 'title', description: 'Visible page title or null if absent' }], signal));
      assert.equal(values.query, '咖啡😀');
      results.fields = { verifiedByIndependentNativeQuery: true, values, source: 'screenshot', verification: 'unverified', performance: trace.snapshot() };
    } finally { await readingDriver.releaseInput(); observation.frame.fill(0); trace.finish(); results.fieldTiming = trace.snapshot(); }
  }
} catch (error) {
  results.error = { name: error instanceof Error ? error.name : 'Error', code: (error as { code?: string })?.code, message: error instanceof Error ? error.message : String(error) };
  process.exitCode = 1;
} finally {
  connection.dispose();
  await writeFile(output, JSON.stringify(results, null, 2) + '\n');
  await rm(modules, { recursive: true, force: true }); await rm(state, { recursive: true, force: true });
}
console.log(JSON.stringify(results));
