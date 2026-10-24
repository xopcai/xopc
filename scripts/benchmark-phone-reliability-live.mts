import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import type { PhoneObservation, PhoneReport } from '../src/phone/contracts.js';

assert.equal(process.env.XOPC_PHONE_REAL_MODEL, '1', 'Opt in with XOPC_PHONE_REAL_MODEL=1; this benchmark makes paid model calls');
assert(process.env.ZHIPU_API_KEY, 'Export ZHIPU_API_KEY before running the live benchmark');
const root = resolve('.');
const state = await mkdtemp(join(tmpdir(), 'xopc-phone-reliability-'));
const evidence = resolve(process.env.XOPC_PHONE_EVIDENCE ?? '/tmp/xopc-phone-reliability-live');
const serial = process.env.XOPC_PHONE_EMULATOR_SERIAL ?? 'emulator-5554';
assert(/^emulator-\d+$/.test(serial), 'Only a local Android emulator is permitted');
const modelRef = 'phone-benchmark/autoglm-phone';
const baselineRevision = execFileSync('git', ['rev-parse', '--verify', (process.env.XOPC_PHONE_BASELINE ?? 'HEAD') + '^{commit}'], { cwd: root, encoding: 'utf8' }).trim();
const deadline = AbortSignal.timeout(300_000);
const configPath = join(state, 'xopc.json');
Object.assign(process.env, { XOPC_STATE_DIR: state, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath,
  XOPC_WORKSPACE: state, XOPC_MODELS_JSON: join(state, 'models.json'), XOPC_LOG_CONSOLE: 'false',
  XOPC_LOG_FILE: 'false', PI_CODING_AGENT_DIR: join(state, 'pi') });
await mkdir(evidence, { recursive: true });
await writeFile(configPath, '{}');
await writeFile(join(state, 'models.json'), JSON.stringify({ providers: { 'phone-benchmark': {
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', apiKey: 'ZHIPU_API_KEY',
  models: [{ id: 'autoglm-phone', input: ['text', 'image'], maxTokens: 3000, phoneUse: { profile: 'autoglm-phone-v1' } }],
} } }));

function baselineSource(relative: string, replacements: Record<string, string> = {}) {
  const source = execFileSync('git', ['show', `${baselineRevision}:${relative}`], { cwd: root, encoding: 'utf8' });
  return source.replace(/from (['"])(\.[^'"]+)\1/g, (_match, quote: string, specifier: string) =>
    `from ${quote}${pathToFileURL(replacements[specifier] ?? resolve(root, dirname(relative), specifier)).href}${quote}`);
}
const baselineAdapterPath = join(state, 'baseline-model-adapter.mts');
const baselineRuntimePath = join(state, 'baseline-runtime.mts');
await writeFile(baselineAdapterPath, baselineSource('src/phone/model-adapter.ts'));
await writeFile(baselineRuntimePath, baselineSource('src/phone/runtime.ts', { './model-adapter.js': baselineAdapterPath }));
const [{ ConfigSchema }, { AdbPhoneDriver, resolveAdbPath, runAdb }, { PhoneRepository }, { PhoneRuntime },
  { createPhoneModel }, baselineRuntime, baselineAdapter, database] = await Promise.all([
  import('../src/config/schema.js'), import('../src/phone/adb-driver.js'), import('../src/phone/repository.js'),
  import('../src/phone/runtime.js'), import('../src/phone/model-adapter.js'), import(pathToFileURL(baselineRuntimePath).href),
  import(pathToFileURL(baselineAdapterPath).href), import('../src/storage/sqlite/connection.js'),
]);
const adb = resolveAdbPath(process.env.XOPC_PHONE_ADB_PATH);
const driver = new AdbPhoneDriver(adb);
const connected = await driver.discover(deadline);
assert(connected.some(device => device.serial === serial && device.emulator && device.state === 'device'), 'Configured emulator must be connected and authorized');
const config = ConfigSchema.parse({ phone: { enabled: true, adbPath: adb, maxModelRequests: 8,
  maxActionsPerSession: 8, maxOperationDurationMs: 55_000, maxSessionDurationMs: 90_000 } });
database.openXopcDatabase({ path: ':memory:' });
const repository = new PhoneRepository();
const device = repository.save({ serial, name: 'Isolated reliability benchmark emulator', enabled: true,
  appAccess: 'selected', allowedApps: ['com.android.settings'] });
repository.setDefault(device.id);
const tasks = [
  { id: 'about-to-main', initial: 'about', goal: 'Return from About phone to the main Android Settings list. Scroll if needed until the System option is visible. Do not change any setting.', expectText: 'System',
    verify: (screen: PhoneObservation) => screen.elements.some(node => node.text === 'System') && !screen.elements.some(node => node.text === 'Android version') },
  { id: 'main-to-about', initial: 'main', goal: 'Open About emulated device or About phone from Android Settings. Stop when the Android version row and at least one of Device name, Model or Model & hardware are simultaneously visible on the About phone page. Do not change any setting.', expectText: 'Android version',
    verify: (screen: PhoneObservation) => screen.elements.some(node => node.text === 'Android version') && screen.elements.some(node => /^(Device name|Model|Model & hardware)$/.test(node.text)) },
];
const results: Array<Record<string, unknown>> = [];
let requests = 0;
const nativeFetch = globalThis.fetch;
// Bound actual HTTP requests as well as the runtime's counters.
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes('/chat/completions')) { requests++; assert(requests <= 32, 'Global model request budget exhausted'); }
  return nativeFetch(input, init);
};
async function shell(args: string[]) { return runAdb(adb, ['-s', serial, 'shell', ...args], deadline); }
async function reset(initial: string) {
  await shell(['am', 'force-stop', 'com.android.settings']);
  await shell(['am', 'start', '-W', '-f', '0x10008000', '-n', 'com.android.settings/.Settings']);
  await delay(800, undefined, { signal: deadline });
  if (initial === 'about') {
    let opened = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const observation = await driver.observe(serial, deadline);
      try {
        assert.equal(observation.package, 'com.android.settings', 'Setup must stay in Settings');
        const target = observation.elements.find(node => /^(About emulated device|About phone)$/.test(node.text));
        if (target) {
          const point = [500 * (target.bounds[0] + target.bounds[2]) / observation.width,
            500 * (target.bounds[1] + target.bounds[3]) / observation.height];
          await driver.execute(serial, { type: 'tap', point }, observation, deadline);
          opened = true; break;
        }
        await driver.execute(serial, { type: 'swipe', start: [500, 850], end: [500, 300], durationMs: 500 }, observation, deadline);
      } finally { observation.frame.fill(0); }
    }
    assert(opened, 'Setup could not open About through the Settings navigation stack');
    await delay(500, undefined, { signal: deadline });
  }
}
function fingerprint(screen: PhoneObservation) {
  return createHash('sha256').update(JSON.stringify({ package: screen.package, width: screen.width, height: screen.height,
    elements: screen.elements.map(({ text, resourceId, bounds }) => ({ text, resourceId, bounds })) })).digest('hex');
}
const arms = [
  { name: 'baseline', Runtime: baselineRuntime.PhoneRuntime as typeof PhoneRuntime, factory: baselineAdapter.createPhoneModel as typeof createPhoneModel },
  { name: 'optimized', Runtime: PhoneRuntime, factory: createPhoneModel },
];
try {
  for (const task of tasks) for (const arm of arms) {
    deadline.throwIfAborted();
    await reset(task.initial);
    const before = await driver.observe(serial, deadline);
    assert.equal(before.package, 'com.android.settings', 'Initial screen must be the authorized Settings app');
    const initialFingerprint = fingerprint(before);
    const initialSatisfied = task.verify(before); before.frame.fill(0);
    assert(!initialSatisfied, `${task.id} must not already satisfy its target`);
    const runtime = new arm.Runtime(repository, () => driver, arm.factory);
    const owner = `live-benchmark-${task.id}-${arm.name}`;
    const context = { config, agentId: 'main', modelRef };
    const startedAt = Date.now(); const requestsBefore = requests;
    let report: PhoneReport | undefined; let errorCode: string | undefined;
    try {
      await runtime.execute(owner, { op: 'open', deviceId: device.id, mode: 'control' }, context, deadline);
      report = await runtime.execute(owner, { op: 'run', goal: task.goal, expectText: task.expectText, ...(task.id === 'main-to-about' ? { completion: { appPackage: 'com.android.settings', textAny: ['Device name', 'Model', 'Model & hardware'] } } : {}), maxActions: 8 }, context, deadline) as PhoneReport;
    } catch (error) { errorCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'BENCHMARK_OPERATION_FAILED'; report = runtime.status(owner); }
    try {
      const after = await driver.observe(serial, deadline);
      const independentEvidence = { packageAllowed: after.package === 'com.android.settings',
        targetTextVisible: after.elements.some(node => node.text === task.expectText),
        aboutIdentityVisible: after.elements.some(node => /^(Device name|Model|Model & hardware)$/.test(node.text)) };
      const independentlyCompleted = after.package === 'com.android.settings' && task.verify(after);
      after.frame.fill(0);
      results.push({ task: task.id, arm: arm.name, repeat: 1, initialFingerprint, independentlyCompleted, independentEvidence,
        runtimeVerified: report?.verified ?? false, status: report?.status, stopReason: report?.stopReason,
        errorCode: errorCode ?? report?.errorCode, actions: report?.actions ?? 0,
        modelRequests: report?.modelRequests ?? 0, actualModelRequests: requests - requestsBefore,
        durationMs: Date.now() - startedAt, diagnostics: report?.diagnostics });
      console.log(JSON.stringify(results.at(-1)));
      await writeFile(join(evidence, 'partial-results.json'), JSON.stringify(results, null, 2));
    } finally { await runtime.shutdown(); }
  }
} finally {
  globalThis.fetch = nativeFetch;
  database.closeXopcDatabase();
  const summary = { benchmark: 'phone-reliability-live', testedAt: new Date().toISOString(), baselineRevision,
    model: modelRef, localEmulator: serial, repeats: 1, maxActionsPerRun: 8, maxModelRequestsPerRun: 8,
    actualModelRequests: requests, baselineScope: 'Original runtime and adapter; shared current ADB driver; reversible Settings navigation only',
    limitations: ['Two tasks and one repeat per arm do not establish general task completion-rate gains.',
      'No transaction, Unicode replacement, CAPTCHA, cloud phone or human takeover was exercised.',
      'Both arms receive the same goal, expectText and completion input; the original runtime ignores the new completion predicate.'],
    pairedInitialStates: tasks.map(task => { const rows = results.filter(row => row.task === task.id); return { task: task.id, identicalNativeUi: rows.length === 2 && rows[0].initialFingerprint === rows[1].initialFingerprint }; }),
    arms: arms.map(arm => { const rows = results.filter(row => row.arm === arm.name); return { arm: arm.name, completed: rows.filter(row => row.independentlyCompleted).length, total: rows.length,
      actualModelRequests: rows.reduce((sum, row) => sum + Number(row.actualModelRequests), 0),
      durationMs: rows.reduce((sum, row) => sum + Number(row.durationMs), 0) }; }), results };
  await writeFile(join(evidence, 'result.json'), JSON.stringify(summary, null, 2));
  await rm(state, { recursive: true, force: true });
  console.log(JSON.stringify({ report: join(evidence, 'result.json'), arms: summary.arms, actualModelRequests: requests }));
}
