import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import type { PhoneAction, PhoneDecision, PhoneObservation, PhoneReport } from '../src/phone/contracts.js';
import type { PhoneModelAdapter, PhonePrediction } from '../src/phone/model-adapter.js';
import type { PhoneDriver } from '../src/phone/adb-driver.js';
import { CLOCK, FILES, SETTINGS, SETTINGS_SEARCH, SCRATCH_FILES, tasks, type Task, type TaskDevice } from './phone-apps-live/tasks.js';
import { decisionTrace, errorCode, fingerprint, loadBaseline, nativeFacts, sourceHashes, type ArmName, type TrialTrace } from './phone-apps-live/support.js';
import { readResponseMetadata } from './phone-apps-live/response-reader.js';
import { classifyModelActionEnvelope } from './phone-apps-live/protocol-envelope-diagnostics.js';
import { classifyAlternativeActionContracts } from './phone-apps-live/protocol-alternatives.js';

const option = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const boundedInteger = (name: string, fallback: number, low: number, high: number) => {
  const value = Number(option(name) ?? fallback); assert(Number.isInteger(value) && value >= low && value <= high, `${name} must be ${low}..${high}`); return value;
};
if (process.argv.includes('--list-tasks')) {
  console.log(JSON.stringify(tasks.map(({ id, app, goal }) => ({ id, app, goal })), null, 2));
  process.exit(0);
}
assert.equal(process.env.XOPC_PHONE_REAL_MODEL, '1', 'Opt in with XOPC_PHONE_REAL_MODEL=1; this suite makes paid model calls');
assert(process.env.ZHIPU_API_KEY, 'Export ZHIPU_API_KEY before running; its value is never printed');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselineDirectory = resolve(option('--baseline-dir') ?? (await readFile('/tmp/xopc-phone-real-baseline-path', 'utf8')).trim());
const evidence = resolve(option('--output') ?? join(tmpdir(), `xopc-phone-apps-live-${Date.now()}`));
assert(!existsSync(join(evidence, 'result.json')), 'Choose a fresh output directory; existing results are never overwritten');
const repeats = boundedInteger('--repeats', 3, 1, 5);
const requestsPerTrial = boundedInteger('--trial-requests', 8, 1, 30);
const actionsPerTrial = boundedInteger('--trial-actions', 12, 1, 12);
const trialMs = boundedInteger('--trial-timeout-ms', 90_000, 1000, 300_000);
const requestCap = boundedInteger('--request-cap', 300, 1, 1000);
const suiteMs = boundedInteger('--suite-timeout-ms', 1_800_000, 1000, 3_600_000);
const requestedTasks = option('--tasks')?.split(',');
const selectedTasks = requestedTasks ? requestedTasks.map(id => { const task = tasks.find(candidate => candidate.id === id); assert(task, `Unknown task ${id}`); return task; }) : tasks;
const selectedArms = (option('--arms')?.split(',') ?? ['baseline', 'optimized']) as ArmName[];
assert(selectedArms.length > 0 && selectedArms.every(arm => ['baseline', 'optimized'].includes(arm)), 'Arms must be baseline and/or optimized');
assert(new Set(selectedArms).size === selectedArms.length && new Set(selectedTasks.map(task => task.id)).size === selectedTasks.length, 'Do not repeat an arm or task identifier');
const saveFrames = process.argv.includes('--save-frames');
const responseMetadata = process.argv.includes('--response-metadata');
const protocolEnvelopeMetadata = process.argv.includes('--protocol-envelope-metadata');
const candidateDirectory = option('--candidate-dir') ? resolve(option('--candidate-dir')!) : undefined;
const serial = process.env.XOPC_PHONE_EMULATOR_SERIAL ?? 'emulator-5554';
assert(/^emulator-\d+$/.test(serial), 'Only a local Android test emulator may be used');
const deadline = AbortSignal.timeout(suiteMs);
const state = await mkdtemp(join(tmpdir(), 'xopc-phone-apps-state-'));
// Generated modules live under the project so package imports resolve identically.
const modules = await mkdtemp(join(root, '.phone-apps-baseline-'));
const modelRef = 'phone-apps-benchmark/autoglm-phone';
const configPath = join(state, 'xopc.json');
Object.assign(process.env, { XOPC_STATE_DIR: state, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath,
  XOPC_WORKSPACE: state, XOPC_MODELS_JSON: join(state, 'models.json'), XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false', PI_CODING_AGENT_DIR: join(state, 'pi') });
await mkdir(evidence, { recursive: true });
await writeFile(configPath, '{}');
await writeFile(join(state, 'models.json'), JSON.stringify({ providers: { 'phone-apps-benchmark': {
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', apiKey: 'ZHIPU_API_KEY',
  models: [{ id: 'autoglm-phone', input: ['text', 'image'], maxTokens: 3000, phoneUse: { profile: 'autoglm-phone-v1' } }],
} } }));

const [baseline, currentRuntime, currentModel, currentDriver, database, { ConfigSchema }, { PhoneRepository }] = await Promise.all([
  loadBaseline(root, baselineDirectory, modules), import('../src/phone/runtime.js'), import('../src/phone/model-adapter.js'),
  import('../src/phone/adb-driver.js'), import('../src/storage/sqlite/connection.js'), import('../src/config/schema.js'), import('../src/phone/repository.js'),
]);
const hostHashes = await sourceHashes(join(root, 'src/phone'));
const candidate = candidateDirectory ? await loadBaseline(root, candidateDirectory, join(modules, 'candidate')) : undefined;
const currentHashes = candidate?.hashes ?? hostHashes;
const diagnosticContracts = await import('../src/phone/contracts.js');
const harnessSourceSha256 = Object.fromEntries(await Promise.all(['scripts/benchmark-phone-apps-live.mts', 'scripts/phone-apps-live/tasks.ts', 'scripts/phone-apps-live/support.ts', 'scripts/phone-apps-live/response-metadata.ts', 'scripts/phone-apps-live/response-reader.ts', 'scripts/phone-apps-live/protocol-envelope-diagnostics.ts', 'scripts/phone-apps-live/protocol-alternatives.ts'].map(async name => [name, createHash('sha256').update(await readFile(join(root, name))).digest('hex')])));
const adb = currentDriver.resolveAdbPath(process.env.XOPC_PHONE_ADB_PATH);
const setupDriver = new currentDriver.AdbPhoneDriver(adb);
const shell = async (args: string[], signal: AbortSignal = deadline) => currentDriver.runAdb(adb, ['-s', serial, 'shell', ...args], signal);
const discovery = await setupDriver.discover(deadline);
assert(discovery.some(device => device.serial === serial && device.emulator && device.state === 'device'), 'The selected emulator must be connected and authorized');
const avd = (await shell(['getprop', 'ro.boot.qemu.avd_name'])).toString().trim();
assert.equal(avd, 'XOPC_Android_Test_API_35', 'This suite only resets the dedicated XOPC Android test AVD');
const androidVersion = (await shell(['getprop', 'ro.build.version.release'])).toString().trim();
const installed = new Set((await shell(['pm', 'list', 'packages'])).toString().split(/\r?\n/).map(line => line.replace(/^package:/, '').trim()));
for (const task of selectedTasks) for (const app of task.allowedApps) assert(installed.has(app), `Task ${task.id} requires installed ${app}`);

const config = ConfigSchema.parse({ phone: { enabled: true, adbPath: adb, maxModelRequests: requestsPerTrial,
  maxActionsPerSession: actionsPerTrial, maxOperationDurationMs: trialMs, maxSessionDurationMs: Math.min(900_000, trialMs + 60_000) } });
database.openXopcDatabase({ path: ':memory:' });
const repository = new PhoneRepository();
let device = repository.save({ serial, name: 'Dedicated live app benchmark', enabled: true, appAccess: 'selected', allowedApps: [...new Set(selectedTasks.flatMap(task => task.allowedApps))] });
const packageVersions = Object.fromEntries(await Promise.all([...new Set(selectedTasks.flatMap(task => task.allowedApps))].map(async app => {
  const dump = (await shell(['dumpsys', 'package', app])).toString();
  return [app, { versionName: /versionName=([^\s]+)/.exec(dump)?.[1], versionCode: /versionCode=(\d+)/.exec(dump)?.[1] }];
})));
for (const [name, contents] of Object.entries(SCRATCH_FILES)) {
  const destination = `/sdcard/Download/${name}`;
  const expected = createHash('sha256').update(contents).digest('hex');
  const existing = await shell(['sha256sum', destination]).then(bytes => bytes.toString().split(/\s/)[0], () => undefined);
  assert(!existing || existing === expected, `Refusing to overwrite an unrelated file named ${name}`);
  if (!existing) {
    const local = join(state, name); await writeFile(local, contents);
    await currentDriver.runAdb(adb, ['-s', serial, 'push', local, destination], deadline);
  }
}

const observe = () => setupDriver.observe(serial, deadline);
const setup: TaskDevice & { type(text: string): Promise<void>; swipe(): Promise<void> } = {
  observe,
  async forceStop(app) { await shell(['am', 'force-stop', app]); },
  async start(app) {
    const resolved = (await shell(['cmd', 'package', 'resolve-activity', '--brief', app])).toString().trim().split(/\r?\n/)
      .find(line => /^[\w.]+\/[\w.$]+$/.test(line));
    assert(resolved, `No launchable activity for ${app}`);
    await shell(['am', 'start', '-W', '-f', '0x10008000', '-n', resolved]);
    await delay(500, undefined, { signal: deadline });
  },
  async tap(label, options) {
    let found = false;
    for (let attempt = 0; attempt < 3 && !found; attempt++) {
      const screen = await observe();
      try {
        const candidates = screen.elements.filter(candidate => !candidate.password && candidate.bounds[2] > candidate.bounds[0] && candidate.bounds[3] > candidate.bounds[1]
          && (!options?.resourceId || candidate.resourceId === options.resourceId)
          && (options?.preferDescription ? candidate.description === label : candidate.text === label || candidate.description === label));
        const target = candidates[0];
        if (target) {
          await setupDriver.execute(serial, { type: 'tap', point: [500 * (target.bounds[0] + target.bounds[2]) / screen.width,
            500 * (target.bounds[1] + target.bounds[3]) / screen.height] }, screen, deadline);
          found = true;
        }
      } finally { screen.frame.fill(0); }
    }
    assert(found, `Setup cannot find ${label} (${options?.resourceId ?? 'visible label'})`);
  },
  async pressBack() { const screen = await observe(); try { await setupDriver.execute(serial, { type: 'back' }, screen, deadline); } finally { screen.frame.fill(0); } },
  async type(text) { const screen = await observe(); try { await setupDriver.execute(serial, { type: 'typeText', text, mode: 'replace' }, screen, deadline); } finally { screen.frame.fill(0); } },
  async swipe() { const screen = await observe(); try { await setupDriver.execute(serial, { type: 'swipe', start: [500, 850], end: [500, 350], durationMs: 500 }, screen, deadline); } finally { screen.frame.fill(0); } },
};

async function demonstrate(task: Task) {
  if (task.id === 'settings-about-version') {
    for (let attempt = 0; attempt < 6; attempt++) {
      const screen = await observe();
      const title = screen.elements.find(candidate => /^(About emulated device|About phone)$/.test(candidate.text))?.text;
      screen.frame.fill(0);
      if (title) { await setup.tap(title); break; }
      await setup.swipe();
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const screen = await observe(); const met = Object.values(task.evidence(screen, androidVersion)).every(Boolean); screen.frame.fill(0);
      if (met) break;
      await setup.swipe();
    }
  } else if (task.id === 'settings-display') {
    let opened = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const screen = await observe();
      const label = screen.elements.find(candidate => ['Display & touch', 'Display'].includes(candidate.text))?.text;
      screen.frame.fill(0);
      if (label) { await setup.tap(label); opened = true; break; }
      await setup.swipe();
    }
    assert(opened, 'Cannot manually open Display settings');
  } else if (task.id === 'settings-search-display') {
    await setup.tap('Search settings'); await setup.type('display');
  } else if (task.id === 'clock-stopwatch') {
    await setup.tap('Stopwatch', { resourceId: `${CLOCK}:id/tab_menu_stopwatch` });
  } else if (task.id === 'clock-timer-configure') {
    await setup.tap('Timer', { resourceId: `${CLOCK}:id/tab_menu_timer` });
    for (const digit of ['2', '3', '0']) await setup.tap(digit, { resourceId: `${CLOCK}:id/timer_setup_digit_${digit}` });
  } else if (task.id === 'files-downloads') {
    await setup.tap('Show roots', { preferDescription: true }); await setup.tap('Downloads', { resourceId: 'android:id/title' });
  } else if (task.id === 'files-search') {
    await setup.tap('Search', { resourceId: 'com.google.android.documentsui:id/option_menu_search', preferDescription: true });
    await setup.type('xopc_real_bench_note_20261024');
  }
  await delay(400, undefined, { signal: deadline });
}

const trialResults: Array<Record<string, any>> = [];
const setupResults: Array<Record<string, unknown>> = [];
const nativeFetch = globalThis.fetch;
let actualRequests = 0;
let activeTrace: TrialTrace | undefined;
let suiteError: string | undefined;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const modelRequest = url.includes('/chat/completions');
  if (modelRequest) {
    if (actualRequests >= requestCap) throw Object.assign(new Error('Suite request cap reached'), { code: 'BENCHMARK_REQUEST_CAP' });
    actualRequests++; activeTrace?.push({ event: 'model_http_request', request: actualRequests, at: Date.now() });
  }
  const request = actualRequests;
  const response = await nativeFetch(input, init);
  if (modelRequest && (responseMetadata || protocolEnvelopeMetadata)) {
    const format = response.ok ? await readResponseMetadata(response, undefined, protocolEnvelopeMetadata ? raw => {
      const validate = (candidate: string) => currentModel.parseAutoGlmResponse(candidate, [], { appAccess: 'all' });
      let wholeResponseParseable = false; let wholeResponseCode: 'PHONE_MODEL_PROTOCOL' | 'PHONE_APP_DENIED' | 'OTHER' | undefined;
      try { validate(raw); wholeResponseParseable = true; }
      catch (error) { const code = errorCode(error); wholeResponseCode = code === 'PHONE_MODEL_PROTOCOL' || code === 'PHONE_APP_DENIED' ? code : 'OTHER'; }
      return { ...classifyModelActionEnvelope(raw, validate), wholeResponseParseable, wholeResponseCode,
        alternatives: classifyAlternativeActionContracts(raw, { decision: value => diagnosticContracts.PhoneDecisionSchema.safeParse(value).success, action: value => diagnosticContracts.PhoneActionSchema.safeParse(value).success }) };
    } : undefined) : { readIssue: 'http_error' };
    activeTrace?.push({ event: 'model_response_metadata', request, at: Date.now(), httpStatus: response.status, ...format });
  }
  return response;
};
const definitions = {
  baseline: { Runtime: baseline.runtime.PhoneRuntime as typeof currentRuntime.PhoneRuntime,
    modelFactory: baseline.model.createPhoneModel as typeof currentModel.createPhoneModel,
    Driver: baseline.driver.AdbPhoneDriver as typeof currentDriver.AdbPhoneDriver },
  optimized: { Runtime: (candidate?.runtime.PhoneRuntime ?? currentRuntime.PhoneRuntime) as typeof currentRuntime.PhoneRuntime,
    modelFactory: (candidate?.model.createPhoneModel ?? currentModel.createPhoneModel) as typeof currentModel.createPhoneModel,
    Driver: (candidate?.driver.AdbPhoneDriver ?? currentDriver.AdbPhoneDriver) as typeof currentDriver.AdbPhoneDriver },
};

const SETTING_KEYS = ['screen_brightness', 'screen_brightness_mode', 'screen_off_timeout', 'font_scale'];
async function settingSnapshot(): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(SETTING_KEYS.map(async key => [key, (await shell(['settings', 'get', 'system', key])).toString().trim()])));
}
async function fileSnapshot(): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(Object.keys(SCRATCH_FILES).map(async name => [name,
    await shell(['sha256sum', `/sdcard/Download/${name}`]).then(bytes => bytes.toString().split(/\s/)[0], () => 'missing')])));
}
function pointInside(point: number[], bounds: number[]): boolean {
  return bounds[0] <= point[0] && point[0] < bounds[2] && bounds[1] <= point[1] && point[1] < bounds[3];
}
function forbiddenPoint(task: Task, action: PhoneAction, screen: PhoneObservation): string | undefined {
  if (!['tap', 'doubleTap', 'longPress'].includes(action.type) || !('point' in action)) return;
  const point = [action.point[0] * screen.width / 1000, action.point[1] * screen.height / 1000];
  if (screen.package === CLOCK && screen.elements.some(candidate => pointInside(point, candidate.bounds)
    && /^(?:start|add alarm|save|add)$/i.test((candidate.description || candidate.text).trim()))) return 'Clock task forbids starting a timer/stopwatch or creating an alarm';
  if (task.app === FILES && screen.package === FILES) for (const filename of screen.elements.filter(candidate => Object.hasOwn(SCRATCH_FILES, candidate.text))) {
    const containers = screen.elements.filter(candidate => candidate.clickable
      && candidate.bounds[0] <= filename.bounds[0] && candidate.bounds[1] <= filename.bounds[1]
      && candidate.bounds[2] >= filename.bounds[2] && candidate.bounds[3] >= filename.bounds[3])
      .sort((a, b) => (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]) - (b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]));
    if (pointInside(point, containers[0]?.bounds ?? filename.bounds)) return 'Files task forbids opening or modifying the seeded files';
  }
}

async function runTrial(task: Task, arm: ArmName, repeat: number) {
  const sourceNow = await sourceHashes(candidateDirectory ?? join(root, 'src/phone'));
  assert.deepEqual(sourceNow, currentHashes, 'Production sources changed during the frozen evaluation');
  const counterpart = trialResults.find(row => row.task === task.id && row.repeat === repeat && row.arm !== arm);
  const initialAttempts: string[] = [];
  let initialFingerprint = ''; let initialFacts: ReturnType<typeof nativeFacts>; let initialOracle: Record<string, boolean>;
  for (let attempt = 0; attempt < 3; attempt++) {
    await task.prepare(setup);
    const initial = await observe();
    initialFingerprint = fingerprint(initial); initialFacts = nativeFacts(initial);
    initialOracle = task.evidence(initial, androidVersion); initial.frame.fill(0);
    initialAttempts.push(initialFingerprint);
    assert(!Object.values(initialOracle).every(Boolean), `Task ${task.id} is already complete in its initial state`);
    if (!counterpart || counterpart.initialFingerprint === initialFingerprint) break;
  }
  if (counterpart && counterpart.initialFingerprint !== initialFingerprint) {
    const trialId = `${task.id}-${repeat}-${arm}`;
    const result = { trialId, task: task.id, app: task.app, arm, repeat, initialFingerprint, initialAttempts, initialOracle,
      setupMismatch: true, independentlyCompleted: false, runtimeVerified: false, falseVerified: false,
      actualModelRequests: 0, modelRequests: 0, actions: 0, durationMs: 0, errorCode: 'UNMATCHED_INITIAL_STATE', traceFile: `${trialId}.json` };
    trialResults.push(result);
    await writeFile(join(evidence, `${trialId}.json`), JSON.stringify({ result, initialFacts, expectedFingerprint: counterpart.initialFingerprint }, null, 2) + '\n');
    await writeFile(join(evidence, 'partial-results.json'), JSON.stringify(trialResults, null, 2) + '\n');
    console.log(JSON.stringify(result)); return;
  }
  device = repository.save({ serial, name: device.name, enabled: true, appAccess: 'selected', allowedApps: task.allowedApps }, device.id);
  const trialId = `${task.id}-${repeat}-${arm}`;
  const trace: TrialTrace = [{ event: 'initial', at: Date.now(), native: initialFacts, oracle: initialOracle }];
  activeTrace = trace;
  const tracePath = join(evidence, `${trialId}.json`);
  const persistTrace = () => writeFile(tracePath, JSON.stringify({ task: task.id, arm, repeat, trace }, null, 2) + '\n');
  let observationCount = 0; let modelStep = 0; let scopeViolation = false;
  const definition = definitions[arm];
  const rawDriver = new definition.Driver(adb);
  const driver = new Proxy(rawDriver, { get(target, property) {
    if (property === 'observe') return async (targetSerial: string, signal: AbortSignal) => {
      const screen = await target.observe(targetSerial, signal); observationCount++;
      trace.push({ event: 'observe', at: Date.now(), native: nativeFacts(screen) }); return screen;
    };
    if (property === 'execute') return async (targetSerial: string, action: PhoneAction, screen: PhoneObservation, signal: AbortSignal, options?: { settleMs: number; resetTask?: boolean }) => {
      trace.push({ event: 'dispatch_attempt', at: Date.now(), action, native: nativeFacts(screen) });
      const refusal = forbiddenPoint(task, action, screen);
      if (refusal) {
        scopeViolation = true; trace.push({ event: 'scope_refusal', reason: refusal, at: Date.now() });
        throw Object.assign(new Error(refusal), { code: 'BENCHMARK_GOAL_SCOPE' });
      }
      try { await target.execute(targetSerial, action, screen, signal, options); trace.push({ event: 'dispatch_completed', at: Date.now(), action }); }
      catch (error) { trace.push({ event: 'dispatch_error', at: Date.now(), code: errorCode(error), action }); throw error; }
      finally { await persistTrace(); }
    };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } }) as PhoneDriver;
  const factory = async (...args: Parameters<typeof currentModel.createPhoneModel>): Promise<PhoneModelAdapter> => {
    const adapter = await definition.modelFactory(...args);
    return { async predict(input: PhonePrediction, signal: AbortSignal): Promise<PhoneDecision> {
      modelStep++;
      const native = nativeFacts(input.observation);
      if (saveFrames) await writeFile(join(evidence, `${trialId}-${modelStep}.png`), input.observation.frame);
      trace.push({ event: 'predict', at: Date.now(), step: modelStep, native,
        completion: input.completion, recoveryHint: input.recoveryHint, protocolFeedback: input.protocolFeedback,
        trajectory: structuredClone(input.trajectory), progressSummary: input.progressSummary });
      try {
        const decision = await adapter.predict(input, signal);
        trace.push({ event: 'decision', at: Date.now(), step: modelStep, ...decisionTrace(decision) });
        await persistTrace(); return decision;
      } catch (error) { trace.push({ event: 'model_error', at: Date.now(), step: modelStep, code: errorCode(error) }); await persistTrace(); throw error; }
    } };
  };
  const runtime = new definition.Runtime(repository, () => driver, factory);
  const context = { config, agentId: 'main', modelRef };
  const settingsBefore = [SETTINGS, SETTINGS_SEARCH].includes(task.app) ? await settingSnapshot() : undefined;
  const filesBefore = task.app === FILES ? await fileSnapshot() : undefined;
  const requestsBefore = actualRequests; const startedAt = Date.now();
  let report: PhoneReport | undefined; let failureCode: string | undefined;
  try {
    await runtime.execute(trialId, { op: 'open', deviceId: device.id, mode: 'control' }, context, deadline);
    report = await runtime.execute(trialId, { op: 'run', goal: task.goal, completion: task.completion(androidVersion), maxActions: actionsPerTrial }, context, deadline) as PhoneReport;
  } catch (error) { failureCode = errorCode(error); report = runtime.status(trialId); }
  finally { await runtime.shutdown(); activeTrace = undefined; }
  const outcomes: Array<Record<string, boolean>> = [];
  for (let read = 0; read < 2; read++) {
    const screen = await observe(); const oracle = task.evidence(screen, androidVersion); outcomes.push(oracle);
    trace.push({ event: 'independent_final', at: Date.now(), read: read + 1, native: nativeFacts(screen), oracle }); screen.frame.fill(0);
  }
  const settingsAfter = settingsBefore ? await settingSnapshot() : undefined;
  const filesAfter = filesBefore ? await fileSnapshot() : undefined;
  const settingsUnchanged = !settingsBefore || JSON.stringify(settingsBefore) === JSON.stringify(settingsAfter);
  const filesUnchanged = !filesBefore || JSON.stringify(filesBefore) === JSON.stringify(filesAfter);
  if (!settingsUnchanged || !filesUnchanged) scopeViolation = true;
  trace.push({ event: 'authoritative_invariants', settingsBefore, settingsAfter, settingsUnchanged, filesBefore, filesAfter, filesUnchanged, at: Date.now() });
  const completed = !scopeViolation && outcomes.every(outcome => Object.values(outcome).every(Boolean));
  const result = { trialId, task: task.id, app: task.app, arm, repeat, initialFingerprint, initialAttempts, initialOracle, setupMismatch: false,
    independentlyCompleted: completed, independentEvidence: outcomes, runtimeVerified: report?.verified ?? false,
    falseVerified: report?.verified === true && !completed, status: report?.status, stopReason: report?.stopReason,
    errorCode: failureCode ?? report?.errorCode, scopeViolation, settingsUnchanged, filesUnchanged, actions: report?.actions ?? 0,
    modelRequests: report?.modelRequests ?? 0, actualModelRequests: actualRequests - requestsBefore, observationCount,
    durationMs: Date.now() - startedAt, diagnostics: report?.diagnostics, traceFile: `${trialId}.json` };
  trialResults.push(result);
  if (!settingsUnchanged && settingsBefore) for (const [key, value] of Object.entries(settingsBefore) as Array<[string, string]>) {
    await shell(value === 'null' ? ['settings', 'delete', 'system', key] : ['settings', 'put', 'system', key, value]);
  }
  if (!filesUnchanged) for (const [name, contents] of Object.entries(SCRATCH_FILES)) {
    const local = join(state, name); await writeFile(local, contents);
    await currentDriver.runAdb(adb, ['-s', serial, 'push', local, `/sdcard/Download/${name}`], deadline);
  }
  if (!settingsUnchanged || !filesUnchanged) trace.push({ event: 'restore_test_invariants', at: Date.now() });
  await persistTrace();
  await writeFile(join(evidence, 'partial-results.json'), JSON.stringify(trialResults, null, 2) + '\n');
  console.log(JSON.stringify(result));
}

try {
  if (process.argv.includes('--setup-only')) {
    for (const task of selectedTasks) {
      await task.prepare(setup); const initial = await observe();
      const initialEvidence = task.evidence(initial, androidVersion); const initialFacts = nativeFacts(initial); initial.frame.fill(0);
      assert(!Object.values(initialEvidence).every(Boolean), `Already complete initially: ${task.id}`);
      await writeFile(join(evidence, `${task.id}-setup-initial.json`), JSON.stringify(initialFacts, null, 2) + '\n');
      await demonstrate(task);
      const after = await observe(); const targetEvidence = task.evidence(after, androidVersion); const targetFacts = nativeFacts(after); after.frame.fill(0);
      const passed = Object.values(targetEvidence).every(Boolean);
      setupResults.push({ task: task.id, passed, initialEvidence, targetEvidence, initialFacts, targetFacts });
      await writeFile(join(evidence, 'setup-oracles.json'), JSON.stringify(setupResults, null, 2) + '\n');
      console.log(JSON.stringify({ task: task.id, setupPassed: passed, initialEvidence, targetEvidence }));
      assert(passed, `Manual target demonstration did not satisfy ${task.id} oracle; fix setup before model evaluation`);
    }
  } else {
    for (let repeat = 1; repeat <= repeats; repeat++) for (const [taskIndex, task] of selectedTasks.entries()) {
      const order = (repeat + taskIndex) % 2 === 0 ? [...selectedArms].reverse() : selectedArms;
      for (const arm of order) {
        deadline.throwIfAborted();
        if (actualRequests >= requestCap) throw Object.assign(new Error('Suite request cap reached'), { code: 'BENCHMARK_REQUEST_CAP' });
        await runTrial(task, arm, repeat);
      }
    }
  }
} catch (error) { suiteError = errorCode(error); console.error(JSON.stringify({ suiteError, message: error instanceof Error ? error.message.slice(0, 500) : String(error) })); process.exitCode = 1; }
finally {
  globalThis.fetch = nativeFetch;
  if (selectedTasks.some(task => task.app === CLOCK) && !deadline.aborted) {
    try { await tasks.find(task => task.id === 'clock-stopwatch')!.prepare(setup); }
    catch (error) { console.error(JSON.stringify({ cleanupError: errorCode(error) })); }
  }
  database.closeXopcDatabase();
  const pairs = selectedTasks.flatMap(task => Array.from({ length: repeats }, (_, index) => {
    const repeat = index + 1; const rows = trialResults.filter(row => row.task === task.id && row.repeat === repeat);
    return { task: task.id, repeat, bothArmsRun: rows.length === 2, identicalNativeUi: rows.length === 2 && rows[0].initialFingerprint === rows[1].initialFingerprint };
  }));
  const eligible = new Set(pairs.filter(pair => pair.bothArmsRun && pair.identicalNativeUi).map(pair => `${pair.task}:${pair.repeat}`));
  const pairedRows = trialResults.filter(row => eligible.has(`${row.task}:${row.repeat}`));
  const pairedOutcomes = pairs.filter(pair => pair.bothArmsRun && pair.identicalNativeUi).map(pair => {
    const before = trialResults.find(row => row.task === pair.task && row.repeat === pair.repeat && row.arm === 'baseline');
    const after = trialResults.find(row => row.task === pair.task && row.repeat === pair.repeat && row.arm === 'optimized');
    return { task: pair.task, repeat: pair.repeat, baselineCompleted: Boolean(before?.independentlyCompleted), optimizedCompleted: Boolean(after?.independentlyCompleted) };
  });
  const summary = { benchmark: 'phone-apps-live', testedAt: new Date().toISOString(), suiteError, localEmulator: serial, avd, androidVersion,
    model: modelRef, packageVersions, harnessSourceSha256, baseline: { sourceSha256: baseline.hashes, canonicalContractsWhenIdentical: baseline.canonicalContracts }, optimized: { sourceSha256: currentHashes, source: candidateDirectory ? 'candidate-directory' : 'working-tree' }, hostSourceSha256: hostHashes, responseMetadata, protocolEnvelopeMetadata, protocolEnvelopeValidator: protocolEnvelopeMetadata ? 'working-tree parseAutoGlmResponse, appAccess all, validation only' : undefined,
    budget: { repeats, actionsPerTrial, requestsPerTrial, trialMs, requestCap, suiteMs }, selectedTasks: selectedTasks.map(task => ({ id: task.id, app: task.app, goal: task.goal, completion: task.completion(androidVersion) })),
    plannedTrials: selectedTasks.length * repeats * selectedArms.length, finishedTrials: trialResults.length,
    actualModelRequests: actualRequests, setupOnly: process.argv.includes('--setup-only'), setupResults, pairedInitialStates: pairs, pairedOutcomes,
    matchedPairEfficacy: selectedArms.map(arm => { const rows = pairedRows.filter(row => row.arm === arm); return { arm,
      completed: rows.filter(row => row.independentlyCompleted).length, total: rows.length,
      falseVerified: rows.filter(row => row.falseVerified).length, actualModelRequests: rows.reduce((sum, row) => sum + row.actualModelRequests, 0) }; }),
    arms: selectedArms.map(arm => { const rows = trialResults.filter(row => row.arm === arm); return { arm, completed: rows.filter(row => row.independentlyCompleted).length, total: rows.length,
      falseVerified: rows.filter(row => row.falseVerified).length, actualModelRequests: rows.reduce((sum, row) => sum + row.actualModelRequests, 0),
      durationMs: rows.reduce((sum, row) => sum + row.durationMs, 0) }; }), results: trialResults,
    limitations: ['Dedicated emulator, three system apps and scratch files; no claims about third-party apps, production accounts or transactions.',
      'Independent completion requires two final native observations; runtime status alone is not success.',
      'Obvious Clock Start/Add alarm/Save/Add and seeded-file point actions are blocked equally because task goals forbid those effects.',
      'Task setup and manual oracle demonstrations are excluded from live model completion counts; initial-state mismatches remain in raw rows but are excluded from matched-pair efficacy.',
      'Settings brightness/mode/timeout/font-scale and two scratch-file checksums are checked; other negative constraints are not exhaustively verified.',
      'Observation counts include runtime-facing observe calls, not driver-internal retries.',
      'A small paired sample measures these fixed tasks only and does not establish general success-rate gains.'] };
  await writeFile(join(evidence, 'result.json'), JSON.stringify(summary, null, 2) + '\n');
  await rm(modules, { recursive: true, force: true }); await rm(state, { recursive: true, force: true });
  console.log(JSON.stringify({ report: join(evidence, 'result.json'), arms: summary.arms, actualModelRequests: actualRequests, suiteError }));
}
